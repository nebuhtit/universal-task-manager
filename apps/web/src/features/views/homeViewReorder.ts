/** Ten collapsed Views are not enough unless every View is collapsed. */
export const canReorderHomeViews = (total: number, expanded: number) => total > 0 && (expanded === 0 || total - expanded > 10);
