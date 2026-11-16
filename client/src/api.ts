export interface Account {
  email: string;
  role: string;
  licenseAccepted: boolean;
  twoFactor: boolean;
  /** Reviewers and admins must turn on two-factor authentication before using their tools. */
  twoFactorRequired: boolean;
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

export interface QuizPhase {
  phase: string;
  passed: boolean;
  /** Whether each of the latest answers in this phase was correct, oldest first. */
  recent: boolean[];
  length: number;
  needed: number;
}

export interface QuizProgress {
  answered: number;
  phases: QuizPhase[];
  qualified: boolean;
  /** Qualification was lost to hidden checks. */
  lostToChecks: boolean;
}

export interface QuizItem {
  id: string;
  imageUrl: string;
}

export interface QuizFeedback {
  correct: boolean;
  answer: { category: string; manchu?: string; abkai?: string; mollendorff?: string };
  source: string;
  progress: QuizProgress;
}

export interface TrainingStatus {
  classes: { scriptClass: string; progress: QuizProgress }[];
  qualified: string[];
}

/** An error from the API, with its HTTP status. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options?: { method: string; body?: unknown }): Promise<T> {
  const response = await fetch(path, {
    method: options?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(body?.error ?? "Something went wrong", response.status);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const getAccount = () => request<Account>("/api/auth/me");
/** Logging in returns the account, or asks for a two-factor code first. */
export const logIn = (email: string, password: string) =>
  request<Account | { twoFactor: true }>("/api/auth/login", { method: "POST", body: { email, password } });
export const logInWithCode = (code: string) =>
  request<Account>("/api/auth/login/two-factor", { method: "POST", body: { code } });
export const logOut = () => request<void>("/api/auth/logout", { method: "POST" });
export const acceptLicense = () => request<Account>("/api/auth/accept-license", { method: "POST" });
export const getTrainingStatus = () => request<TrainingStatus>("/api/training/status");
const quizPath = (scriptClass: string, practice: boolean) =>
  `/api/training/${scriptClass}${practice ? "/practice" : ""}`;
export const getQuizItem = (scriptClass: string, practice = false) =>
  request<{ item: QuizItem | null; progress: QuizProgress }>(`${quizPath(scriptClass, practice)}/next`);
export const answerQuiz = (
  scriptClass: string,
  answer: { category: string; transcription?: string },
  practice = false,
) =>
  request<QuizFeedback>(`${quizPath(scriptClass, practice)}/answer`, { method: "POST", body: answer });
export const resetQuiz = (scriptClass: string) =>
  request<{ progress: QuizProgress }>(`/api/training/${scriptClass}/reset`, { method: "POST" });
export const getNextImage = () => request<{ image: LabelImage | null }>("/api/labelling/next");
export const getContext = (id: string) => request<PageContext>(`/api/labelling/${id}/context`);
export const submitLabel = (id: string, label: Label) =>
  request<void>(`/api/labelling/${id}`, { method: "POST", body: label });

/** A held-back image whose labelers all agreed, waiting for an admin. */
export interface HeldBackItem {
  id: string;
  imageUrl: string;
  context: PageContext;
  category: string;
  manchu?: string;
  abkai?: string;
  labelers: number;
}

export const getHeldBack = () => request<{ items: HeldBackItem[] }>("/api/review/held-back");
export const decideHeldBack = (item: HeldBackItem, decision: "yes" | "no") =>
  request<void>(`/api/review/held-back/${item.id}`, {
    method: "POST",
    body: { decision, category: item.category, manchu: item.manchu },
  });

export interface Answer {
  category: string;
  manchu?: string;
  abkai?: string;
}

export type DisputeStatus = "open" | "upheld" | "corrected" | "withdrawn";

export interface PastCheck {
  id: string;
  imageUrl: string;
  scriptClass: string;
  passed: boolean;
  accuracy: number;
  label: Answer;
  answer: Answer;
  dispute: DisputeStatus | null;
}

export interface OwnDispute {
  id: string;
  kind: "check" | "quiz";
  imageUrl: string;
  createdAt: string;
  answer: Answer;
  proposed: Answer;
  note?: string;
  outcome: DisputeStatus;
  reviewerNote?: string;
}

export interface Profile {
  creditName: string | null;
  accuracy: { scriptClass: string; answered: number; passed: number; accuracy: number }[];
  checks: PastCheck[];
  disputes: OwnDispute[];
}

export const getProfile = () => request<Profile>("/api/profile");
export const openDispute = (body: {
  kind: "check" | "quiz";
  id: string;
  category: string;
  transcription?: string;
  note?: string;
}) => request<void>("/api/profile/disputes", { method: "POST", body });

/** An open dispute, as a reviewer sees it. */
export interface DisputeItem {
  id: string;
  kind: "check" | "quiz";
  imageUrl: string;
  context?: PageContext;
  source?: string;
  answer: Answer;
  proposed: Answer;
  note?: string;
  createdAt: string;
  graded?: { total: number; passed: number };
}

export const getDisputes = () => request<{ items: DisputeItem[] }>("/api/review/disputes");
export const resolveDispute = (
  id: string,
  body: { outcome: "upheld" | "corrected" | "withdrawn"; category?: string; transcription?: string; note?: string },
) => request<void>(`/api/review/disputes/${id}`, { method: "POST", body });

export interface HeldBackDecision {
  id: string;
  imageUrl: string;
  decision: "yes" | "no";
  category: string;
  manchu?: string;
  abkai?: string;
  decidedAt: string;
}

export const getHeldBackDecisions = () =>
  request<{ items: HeldBackDecision[] }>("/api/review/held-back-decisions");
export const undoHeldBack = (id: string) => request<void>(`/api/review/held-back/${id}/undo`, { method: "POST" });

export interface Reading {
  category: string;
  manchu?: string;
  abkai?: string;
  count: number;
  unsure: number;
}

/** An image whose labels did not settle it, waiting for a reviewer. */
export interface LabelReviewItem {
  id: string;
  imageUrl: string;
  context: PageContext;
  readings: Reading[];
}

export const getLabelReviews = () => request<{ items: LabelReviewItem[] }>("/api/review/labels");
export const reviewLabels = (id: string, answer: { category: string; transcription?: string }) =>
  request<void>(`/api/review/labels/${id}`, { method: "POST", body: answer });

export const setCreditName = (name: string | null) =>
  request<{ creditName: string | null }>("/api/profile/credit", { method: "PUT", body: { name } });

const post = <T = void>(path: string, body: object) => request<T>(path, { method: "POST", body });

export const register = (invite: string, email: string, password: string) =>
  post("/api/auth/register", { invite, email, password });
export const verifyEmail = (token: string) => post("/api/auth/verify-email", { token });
export const resendVerification = (email: string) => post("/api/auth/resend-verification", { email });
export const forgotPassword = (email: string) => post("/api/auth/forgot-password", { email });
export const resetPassword = (token: string, password: string) =>
  post("/api/auth/reset-password", { token, password });
export const changePassword = (current: string, password: string) =>
  post("/api/auth/change-password", { current, password });
export const deleteAccount = (password: string) => post("/api/auth/delete-account", { password });
export const startTwoFactor = (password: string) =>
  post<{ secret: string; uri: string }>("/api/auth/two-factor/setup", { password });
export const enableTwoFactor = (code: string) =>
  post<{ recoveryCodes: string[] }>("/api/auth/two-factor/enable", { code });
export const disableTwoFactor = (password: string, code: string) =>
  post("/api/auth/two-factor/disable", { password, code });
export const newRecoveryCodes = (password: string) =>
  post<{ recoveryCodes: string[] }>("/api/auth/two-factor/recovery-codes", { password });

export interface InviteSummary {
  id: string;
  email?: string;
  role: string;
  note?: string;
  createdAt: string;
  expiresAt: string;
  status: "open" | "used" | "expired";
}

export const getInvites = () => request<{ items: InviteSummary[] }>("/api/admin/invites");
export const createInvite = (body: { email?: string; role: string; note?: string }) =>
  post<{ url: string; expiresAt: string }>("/api/admin/invites", body);
export const withdrawInvite = (id: string) => request<void>(`/api/admin/invites/${id}`, { method: "DELETE" });
