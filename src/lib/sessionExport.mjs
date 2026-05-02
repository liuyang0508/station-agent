function formatMessage(message) {
  const role = message.role === 'assistant' ? 'Agent' : 'User';
  return [`## ${role}`, '', message.content || '', ''].join('\n');
}

export function exportSessionMarkdown(session, messages) {
  return [
    `# ${session.title}`,
    '',
    `- Session: ${session.id}`,
    `- Workspace: ${session.workspaceRoot}`,
    `- Created: ${session.createdAt}`,
    `- Updated: ${session.updatedAt}`,
    '',
    ...messages.map(formatMessage)
  ].join('\n');
}

export function exportSessionJson(session, messages) {
  return {
    session,
    messages
  };
}
