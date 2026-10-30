"use client";

import { ChatPanel } from "../../components/ChatPanel";
import { ModuleShell } from "../../components/ModuleShell";
import { useLanguage } from "../../lib/i18n";

export default function ChatPage() {
  const { t } = useLanguage();
  return (
    <ModuleShell moduleTitle={t.chat.pageTitle} subtitle={t.chat.pageSubtitle}>
      <ChatPanel />
    </ModuleShell>
  );
}
