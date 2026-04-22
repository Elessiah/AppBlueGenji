import { NextResponse } from "next/server";

export type ApiError = { error: string };

export function ok<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400): NextResponse<ApiError> {
  return NextResponse.json({ error: message }, { status });
}
