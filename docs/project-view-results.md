# Projects in Views

In **Edit view → Visual setup**, choose **Items**, **Projects**, or **Items and Projects**. Existing views default to Items. Calendar renderers remain item-only.

**Project selection** filters project names (`project`) and parent Areas (`area`). Both fields support searchable multiple selection. Blocks and Python-like code edit the same expression, for example `return includes(project, "Launch")`. **Item conditions** below it determine which tasks contribute to each selected project. A project with no matching contributors is omitted.

Project rows are derived links, not saved items. They have no completion control; activating the link opens its PARA page. Their percent and remaining time are calculated for this view, not necessarily for the entire project. The optional **Include completed items even when hidden** setting includes completed/auto-closed tasks that would match the item filter as open, retaining its dates, tags and exclusions.

The view total is calculated from unique contributing task IDs, even if a task is displayed individually or belongs to several displayed projects. It never sums project percentages. Reserved-time and external-event exclusion rules continue to apply. Project progress and PARA progress both use completed duration divided by total duration; projects with no duration show a dash. PARA always uses the full project's eligible tasks, independently of view filters.

Storage adds optional `SavedView.resultTypes` and `SavedView.projectQuery`. Derived result rows and metrics are never serialized. Project navigation is memory-only. No schema-version or release-version change is required for these optional fields in the current implementation.
