export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const unauthorized = () => new ApiError(401, 'unauthorized', 'Invalid credentials or session.');
export const forbidden = () => new ApiError(403, 'forbidden', 'This action is not permitted.');
export const notFound = (message = 'Resource not found.') => new ApiError(404, 'not_found', message);
export const invalidRequest = (message: string) => new ApiError(400, 'invalid_request', message);
export const conflict = (message = 'The command conflicts with the accepted state.') => new ApiError(409, 'conflict', message);
export const productUnavailable = (message = 'Product is currently unavailable.') => new ApiError(409, 'product_unavailable', message);
export function exact(value: number, message = 'Amount out of range.'): number {
  if (!Number.isSafeInteger(value)) throw invalidRequest(message);
  return value;
}
