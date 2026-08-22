// The "Update recorded" banner reads the same wherever a verb is applied —
// My Work rows, the process detail panel and the weekly board all show the
// meaning of the update, not just its name. Built once so the three screens
// cannot drift apart.

export function verbResultLabels(t: (key: string) => string): Record<string, string> {
  return {
    recorded: t('work.recorded'),
    undo: t('work.undo'),
    'msg.completed': t('work.msg.completed'),
    'msg.sent_email': t('work.msg.sent_email'),
    'msg.waiting': t('work.msg.waiting'),
    'msg.delayed': t('work.msg.delayed'),
    'msg.scheduled': t('work.msg.scheduled'),
    'msg.not_applicable': t('work.msg.not_applicable'),
    'msg.note': t('work.msg.note'),
  };
}
