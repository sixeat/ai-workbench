// 生成任务（图片/视频）共用的骨架。
//
// 为什么存在：`runImageTask` 与 `runVideoTask` 原本各自实现了同一套流程——
// 任务初始化、启动前取消守卫、凭据回退循环、上游错误归一化、失败兜底。
// 两份实现约有 100 行同构逻辑，改一处容易漏另一处，且服务端工作流编排会需要第三次复用。
//
// 这里只放**确实逐字相同**的部分。媒介差异（请求体构造、成功后的落盘行为、返回状态码）
// 留给各自的 media handler，避免把差异硬塞进开关参数里。

const { getPublicBaseUrl } = require('./mediaUrlService.cjs');

/**
 * 任务执行前的参数准备。
 *
 * taskBody 的合并顺序不能改：任务已存输入 → 本次请求体 → publicBaseUrl 兜底。
 * 顺序一变，重试任务会丢失原始输入里的多模态字段。
 */
function prepareGenerationTask({
  req,
  body = {},
  task,
  createTask,
  taskRepository,
  getPublicBaseUrlFn = getPublicBaseUrl,
}) {
  const activeTask = task || createTask({
    ...body,
    publicBaseUrl: body.publicBaseUrl || getPublicBaseUrlFn(req),
  }, 'running', taskRepository);

  const taskBody = {
    ...(activeTask.input || {}),
    ...body,
    publicBaseUrl: body.publicBaseUrl || activeTask.input?.publicBaseUrl || getPublicBaseUrlFn(req),
  };

  const workerReq = req || { headers: {}, publicBaseUrl: taskBody.publicBaseUrl };

  return { activeTask, taskBody, workerReq };
}

/**
 * worker 启动前的取消守卫。
 *
 * 返回非 null 表示应当立即中止：调用方直接把它当作结果返回。
 * 注意这段必须在解析凭据之前——否则用户取消后仍会去解密 Key。
 */
function guardCancelledBeforeStart({ activeTask, taskRepository }) {
  if (taskRepository.getTask(activeTask.id)?.status !== 'cancelled') return null;

  taskRepository.addTaskLog(activeTask.id, {
    level: 'warn',
    event: 'cancelled_before_start',
    message: 'Task was cancelled before the worker started.',
  });
  return { status: 409, data: { error: 'Task was cancelled.' } };
}

/**
 * 上游已提交、但产物落盘前发现被取消。
 *
 * 用途：丢弃已经拿到手的产物。日志里带上上游任务 id，便于事后对账。
 */
function guardCancelledAfterUpstream({
  activeTask,
  taskRepository,
  nodeType,
  output,
  providerId,
  model,
}) {
  if (taskRepository.getTask(activeTask.id)?.status !== 'cancelled') return null;

  taskRepository.addTaskLog(activeTask.id, {
    level: 'warn',
    event: 'cancelled_after_upstream',
    message: `${nodeType} upstream request finished after cancellation; output was not written.`,
    data: {
      upstreamTaskId: output?.upstream?.taskId || '',
      upstreamStatus: output?.upstream?.status || '',
      providerId,
      model,
    },
  });
  return { status: 409, data: { error: 'Task was cancelled.' } };
}

module.exports = {
  guardCancelledAfterUpstream,
  guardCancelledBeforeStart,
  prepareGenerationTask,
};
