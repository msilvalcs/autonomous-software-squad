import { useState } from "react";
import { createTask, type Task } from "./domain/task";
import "./App.css";

function App() {
  const [title, setTitle] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    try {
      const task = createTask(title);
      setTasks((current) => [...current, task]);
      setTitle("");
      setError("");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to create task"
      );
    }
  }

  return (
    <main className="app">
      <h1>Task App</h1>
      <p>Aplicação criada pelo Autonomous Software Squad.</p>

      <form onSubmit={handleSubmit}>
        <label htmlFor="task-title">Nova tarefa</label>

        <div className="form-row">
          <input
            id="task-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Digite o título"
          />

          <button type="submit">Adicionar</button>
        </div>

        {error && <p role="alert">{error}</p>}
      </form>

      <section>
        <h2>Tarefas</h2>

        {tasks.length === 0 ? (
          <p>Nenhuma tarefa cadastrada.</p>
        ) : (
          <ul>
            {tasks.map((task) => (
              <li key={task.id}>
                {task.title} — {task.status}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export default App;