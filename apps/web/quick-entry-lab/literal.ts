/** A leading dot disables every Live Text command for the whole input. */
export const isLiteralEntry = (input: string): boolean => input.trimStart().startsWith('.');
