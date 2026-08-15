export interface Task {
  id: string;
  title: string;
  status: "TODO" | "DONE";
}

export function createTask(title: string): Task {
  const normalizedTitle = title.trim();

  if (normalizedTitle === "") {
    throw new Error("Task title is required");
  }

  return {
    id: crypto.randomUUID(),
    title: normalizedTitle,
    status: "TODO"
  };
}