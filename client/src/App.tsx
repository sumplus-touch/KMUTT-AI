import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import AuthGate from "./components/AuthGate";
import { ChatNavProvider } from "./components/ChatNavContext";
import ChatPage from "./pages/ChatPage";
import FilesPage from "./pages/FilesPage";
import TasksPage from "./pages/TasksPage";
import SkillsPage from "./pages/SkillsPage";
import SettingsPage from "./pages/SettingsPage";
import ProjectsPage from "./pages/ProjectsPage";
import KnowledgePage from "./pages/KnowledgePage";

export default function App() {
  return (
    <AuthGate>
      {/* Provider wraps Layout so the sidebar can render ChatPage's session list */}
      <ChatNavProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<ChatPage />} />
            <Route path="/knowledge" element={<KnowledgePage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Layout>
      </ChatNavProvider>
    </AuthGate>
  );
}
