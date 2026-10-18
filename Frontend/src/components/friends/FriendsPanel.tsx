"use client";

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { PortalNav } from "@/components/PortalNav";
import { SessionGuard } from "@/components/session-guard";
import { Blueprint } from "@/components/ui/Blueprint";
import { isMonashEmail } from "@/lib/monash-email";
import type { AppRouter } from "@/trpc/routers/_app";

const client = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/api/trpc" })],
});

type Friendship = Awaited<ReturnType<typeof client.friends.list.query>>[number];

const errorText = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

/** Lets a signed-in student send, answer and manage friend requests. */
export function FriendsPanel({ user }: { user: { id: string; name: string } }) {
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setFriendships(await client.friends.list.query());
    } catch (cause) {
      setError(errorText(cause, "Could not load your friends. Try again."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function sendRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    setError("");
    setNotice("");
    if (!isMonashEmail(address)) {
      setError("Use a @student.monash.edu or @monash.edu address.");
      return;
    }
    setSending(true);
    try {
      await client.friends.request.mutate({ email: address });
      // The server never reveals whether an account exists, so neither do we.
      setNotice(
        `If ${address} has a verified account, they will see your request.`,
      );
      setEmail("");
      await load();
    } catch (cause) {
      setError(errorText(cause, "Could not send the request. Try again."));
    } finally {
      setSending(false);
    }
  }

  async function act(id: string, action: () => Promise<unknown>, done: string) {
    setBusyId(id);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(done);
      await load();
    } catch (cause) {
      setError(errorText(cause, "That did not work. Refresh and try again."));
    } finally {
      setBusyId("");
    }
  }

  const respond = (friend: Friendship, action: "accept" | "decline") =>
    act(
      friend.id,
      () => client.friends.respond.mutate({ id: friend.id, action }),
      action === "accept"
        ? `You and ${friend.user.name} are now friends.`
        : `Request from ${friend.user.name} declined.`,
    );

  const remove = (friend: Friendship, done: string) =>
    act(friend.id, () => client.friends.remove.mutate({ id: friend.id }), done);

  const friends = friendships.filter((f) => f.status === "ACCEPTED");
  const incoming = friendships.filter(
    (f) => f.status === "PENDING" && f.direction === "incoming",
  );
  // A declined request still shows as "sent" so the other student's choice stays private.
  const outgoing = friendships.filter(
    (f) => f.status !== "ACCEPTED" && f.direction === "outgoing",
  );

  return (
    <SessionGuard userId={user.id}>
      <div className="account-page">
        <PortalNav studentName={user.name} active="friends" />
        <main className="auth-main">
          <Blueprint className="auth-shell friends-shell">
            <section className="auth-panel" aria-busy={loading}>
              <h1>Friends</h1>
              <p className="auth-panel-description">
                Add friends by their Monash email so you can plan classes
                together. They need to accept your request first.
              </p>

              <form className="friends-add" onSubmit={sendRequest}>
                <label className="field">
                  <span>Friend&apos;s Monash email</span>
                  <input
                    autoComplete="off"
                    inputMode="email"
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="friend@student.monash.edu"
                    required
                    type="email"
                    value={email}
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={sending}
                  type="submit"
                >
                  {sending ? "Sending…" : "Send request"}
                </button>
              </form>

              {error && (
                <p className="form-message error" role="alert">
                  {error}
                </p>
              )}
              {notice && (
                <output className="form-message success">{notice}</output>
              )}

              {loading ? (
                <p className="friends-empty">Loading your friends…</p>
              ) : (
                <>
                  {incoming.length > 0 && (
                    <FriendSection title="Requests for you">
                      {incoming.map((friend) => (
                        <FriendRow key={friend.id} friend={friend}>
                          <button
                            className="primary-button friends-small"
                            disabled={busyId === friend.id}
                            onClick={() => respond(friend, "accept")}
                            type="button"
                          >
                            Accept
                          </button>
                          <button
                            className="secondary-button friends-small"
                            disabled={busyId === friend.id}
                            onClick={() => respond(friend, "decline")}
                            type="button"
                          >
                            Decline
                          </button>
                        </FriendRow>
                      ))}
                    </FriendSection>
                  )}

                  <FriendSection title={`Your friends (${friends.length})`}>
                    {friends.length === 0 ? (
                      <li className="friends-empty">
                        No friends yet. Send a request above to get started.
                      </li>
                    ) : (
                      friends.map((friend) => (
                        <FriendRow key={friend.id} friend={friend}>
                          <button
                            className="secondary-button friends-small"
                            disabled={busyId === friend.id}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Remove ${friend.user.name} from your friends?`,
                                )
                              ) {
                                void remove(
                                  friend,
                                  `${friend.user.name} was removed from your friends.`,
                                );
                              }
                            }}
                            type="button"
                          >
                            Remove
                          </button>
                        </FriendRow>
                      ))
                    )}
                  </FriendSection>

                  {outgoing.length > 0 && (
                    <FriendSection title="Sent requests">
                      {outgoing.map((friend) => (
                        <FriendRow
                          key={friend.id}
                          friend={friend}
                          note="Waiting"
                        >
                          <button
                            className="secondary-button friends-small"
                            disabled={busyId === friend.id}
                            onClick={() =>
                              remove(
                                friend,
                                `Request to ${friend.user.name} cancelled.`,
                              )
                            }
                            type="button"
                          >
                            Cancel
                          </button>
                        </FriendRow>
                      ))}
                    </FriendSection>
                  )}
                </>
              )}
            </section>
          </Blueprint>
        </main>
      </div>
    </SessionGuard>
  );
}

function FriendSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="friends-section">
      <h2>{title}</h2>
      <ul className="friends-list">{children}</ul>
    </section>
  );
}

function FriendRow({
  friend,
  note,
  children,
}: {
  friend: Friendship;
  note?: string;
  children: ReactNode;
}) {
  const name: string = friend.user.name;
  const initials = name
    .trim()
    .split(/\s+/)
    .map((word) => word[0]?.toUpperCase())
    .slice(0, 2)
    .join("");
  return (
    <li className="friends-row">
      <span className="portal-avatar" aria-hidden="true">
        {initials}
      </span>
      <span className="friends-who">
        <strong>{friend.user.name}</strong>
        <small>
          {friend.user.email}
          {note ? ` · ${note}` : ""}
        </small>
      </span>
      <span className="friends-actions">{children}</span>
    </li>
  );
}
