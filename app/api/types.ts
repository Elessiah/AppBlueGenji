export type ApiError = { error: string };
export type ApiSuccess<T = unknown> = T & { success?: true };