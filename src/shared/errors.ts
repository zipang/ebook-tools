/** Represent an expected application error with a stable code. */
export class AppError extends Error {
	readonly code: string;

	/** Create an application error with a code and a message. */
	constructor(code: string, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "AppError";
		this.code = code;
	}
}

/** Represent a validation error for invalid input. */
export class ValidationError extends AppError {
	/** Create a validation error with a message. */
	constructor(message: string) {
		super("validation-error", message);
		this.name = "ValidationError";
	}
}
