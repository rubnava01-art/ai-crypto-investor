"use client";

import { ChatPanel } from "../../components/ChatPanel";
import { ModuleShell } from "../../components/ModuleShell";

export default function ChatPage() {
  return (
    <ModuleShell moduleTitle="Chat" subtitle="Chat en vivo de la plataforma">
      <ChatPanel />
    </ModuleShell>
  );
}
