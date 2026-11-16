/**
 * Raises a security alert. It is always logged as one JSON line, so a log watcher can pick it up, and
 * it is emailed to ALERT_EMAIL when email is set up.
 */

type AlertSender = (subject: string, text: string) => Promise<void>;

let sender: AlertSender | null = null;

/** Called once email is configured, so that alerts are also sent by email. */
export function setAlertSender(send: AlertSender | null): void {
  sender = send;
}

export function alert(event: string, details: Record<string, unknown>): void {
  console.warn(JSON.stringify({ level: "alert", event, at: new Date().toISOString(), ...details }));
  sender?.(`Security alert: ${event}`, JSON.stringify(details, null, 2)).catch((error: unknown) => {
    console.error("Could not send an alert email", error);
  });
}
