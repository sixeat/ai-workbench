export interface LoginFormSnapshot {
  email: string;
  password: string;
}

export function resolveLoginSubmission(
  state: LoginFormSnapshot,
  formValues: Partial<LoginFormSnapshot>
): LoginFormSnapshot {
  return {
    email: formValues.email || state.email,
    password: formValues.password || state.password,
  };
}

export function preserveLoginFormSnapshot(snapshot: LoginFormSnapshot): LoginFormSnapshot {
  return {
    email: snapshot.email,
    password: snapshot.password,
  };
}
