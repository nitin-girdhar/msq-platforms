// @task/web — Task product package. Public surface: the page-level Shells
// apps/web's `(todo)` route group renders, `TaskLeadSection` (the one
// component another product embeds — LMS's LeadEditModal shows a lead's
// linked tasks), and the api client apps/web's cross-product "My Day" widget
// needs. Everything else is internal to this package.

export { default as TasksShell } from './components/tasks/TasksShell';
export { default as TeamTasksShell } from './components/tasks/TeamTasksShell';
export { default as TaskLeadSection } from './components/tasks/TaskLeadSection';

export { endOfTodayISO } from './lib/tasks/format';
export { tasks, taskLists } from './lib/api/client';
