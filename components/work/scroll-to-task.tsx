'use client';

import { useEffect } from 'react';

/**
 * F-10: `?task=<uuid>` deep links relied entirely on the browser's native
 * `#task-<uuid>` hash-anchor scroll — fine for every link this app builds
 * itself (all three generators already append the hash), but fragile
 * against anything that can drop a URL fragment in transit (an email
 * client, a Slack/WhatsApp link preview, a manual paste of just the query
 * string). This makes the query param alone sufficient: scroll on mount,
 * independent of whether the hash survived.
 */
export function ScrollToTask({ taskId }: { taskId: string }) {
  useEffect(() => {
    if (!taskId) return;
    document.getElementById(`task-${taskId}`)?.scrollIntoView({ block: 'center' });
  }, [taskId]);
  return null;
}
