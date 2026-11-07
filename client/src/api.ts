export interface Account {
  email: string;
  role: string;
  licenseAccepted: boolean;
}

export interface LabelImage {
  id: string;
  imageUrl: string;
  style: { production: string; script: string };
}

export interface PageContext {
  pageImageUrl: string;
  width: number;
  height: number;
  box: { x: number; y: number; width: number; height: number };
}

export interface Label {
  category: string;
  transcription?: string;
  intendedWord?: string;
  production?: string;
  script?: string;
  confidence: { category: string; transcription: string; style: string };
}

async function request<T>(path: string, options?: { method: string; body?: unknown }): Promise<T> {
  const response = await fetch(path, {
    method: options?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "Something went wrong");
  }
  return (response.status === 204 || response.status === 201 ? undefined : response.json()) as T;
}

export const getAccount = () => request<Account>("/api/auth/me");
export const logIn = (email: string, password: string) =>
  request<Account>("/api/auth/login", { method: "POST", body: { email, password } });
export const logOut = () => request<void>("/api/auth/logout", { method: "POST" });
export const acceptLicense = () => request<Account>("/api/auth/accept-license", { method: "POST" });
export const getNextImage = () => request<{ image: LabelImage | null }>("/api/labelling/next");
export const getContext = (id: string) => request<PageContext>(`/api/labelling/${id}/context`);
export const submitLabel = (id: string, label: Label) =>
  request<void>(`/api/labelling/${id}`, { method: "POST", body: label });
