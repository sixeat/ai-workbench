import { create } from 'zustand';

interface ImagePreviewState {
  isOpen: boolean;
  url: string;
  title: string;
  openPreview: (url: string, title?: string) => void;
  closePreview: () => void;
}

export const useImagePreviewStore = create<ImagePreviewState>((set) => ({
  isOpen: false,
  url: '',
  title: '',
  openPreview: (url, title = '') => set({ isOpen: true, url, title }),
  closePreview: () => set({ isOpen: false, url: '', title: '' }),
}));
