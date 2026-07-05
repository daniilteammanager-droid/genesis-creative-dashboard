import type { FbtoolApiError } from "./types";

// Build a structured FBTool API error payload.
// Call this in the real API integration layer when an account request fails.
// Never pass the API key into requestParams — strip it before calling this.
export function buildFbtoolApiError(params: {
  statusCode: number;
  errorMessage: string;
  rawBody: string;
  accountId: string;
  dateRange: { from: string; to: string };
  requestParams?: Record<string, unknown>;
}): FbtoolApiError {
  return {
    statusCode:    params.statusCode,
    errorMessage:  params.errorMessage,
    rawBody:       params.rawBody,
    accountId:     params.accountId,
    dateRange:     params.dateRange,
    requestParams: params.requestParams ?? {},
    timestamp:     new Date().toISOString(),
  };
}
