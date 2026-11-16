import { useCallback, useEffect, useState, type FormEvent } from "react";

import { createInvite, getInvites, withdrawInvite, type InviteSummary } from "../api.ts";

const ROLES = [
  ["labeler", "Labeler"],
  ["reviewer", "Reviewer"],
  ["admin", "Admin"],
] as const;

/** Lets an admin invite people. Each link works once, for 14 days, and is only shown when made. */
export function Invites() {
  const [items, setItems] = useState<InviteSummary[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("labeler");
  const [note, setNote] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    getInvites()
      .then(({ items: next }) => setItems(next))
      .catch((failure: Error) => setError(failure.message));
  }, []);
  useEffect(load, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const { url } = await createInvite({ email: email || undefined, role, note: note || undefined });
      setLink(url);
      setEmail("");
      setNote("");
      load();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  return (
    <main className="invites">
      <h2>Invite someone</h2>
      <form className="account-form" onSubmit={submit}>
        <label>
          Their email (optional, to make the link work only for them)
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          Role
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            {ROLES.map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Note for yourself (optional)
          <input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <button type="submit">Make an invite link</button>
        </div>
      </form>
      {link && (
        <div className="notice" role="status">
          <p>Send this link to the person you are inviting. It is only shown now, and works once.</p>
          <p>
            <code className="invite-link">{link}</code>
          </p>
          <button type="button" onClick={() => navigator.clipboard?.writeText(link)}>
            Copy
          </button>
        </div>
      )}
      <h2>Recent invites</h2>
      {items.length === 0 ? (
        <p className="hint">No invites yet.</p>
      ) : (
        <table className="accuracy">
          <thead>
            <tr>
              <th scope="col">For</th>
              <th scope="col">Role</th>
              <th scope="col">Note</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((invite) => (
              <tr key={invite.id}>
                <td>{invite.email ?? "Anyone with the link"}</td>
                <td>{invite.role}</td>
                <td>{invite.note}</td>
                <td>
                  {invite.status === "open" ? `Open until ${new Date(invite.expiresAt).toLocaleDateString()}` : invite.status}
                </td>
                <td>
                  {invite.status === "open" && (
                    <button type="button" className="link" onClick={() => withdrawInvite(invite.id).then(load)}>
                      Withdraw
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
