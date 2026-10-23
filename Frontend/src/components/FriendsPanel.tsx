"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTRPC } from "@/trpc/client";

export function FriendsPanel() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const query = trpc.friends.list.queryOptions();
  const friends = useQuery({ ...query, refetchInterval: 15_000 });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: query.queryKey });
  const request = useMutation(
    trpc.friends.request.mutationOptions({
      onSuccess: async () => {
        setEmail("");
        setNotice("Request processed. Check its status below.");
        await refresh();
      },
    }),
  );
  const respond = useMutation(
    trpc.friends.respond.mutationOptions({ onSuccess: refresh }),
  );
  const remove = useMutation(
    trpc.friends.remove.mutationOptions({ onSuccess: refresh }),
  );
  const busy = request.isPending || respond.isPending || remove.isPending;
  const error = request.error ?? respond.error ?? remove.error ?? friends.error;
  return (
    <div className="mt-4 space-y-6">
      <p>
        Send a request using your friend’s Monash email. Requests appear here in
        their account.
      </p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          setNotice("");
          request.reset();
          respond.reset();
          remove.reset();
          request.mutate({ email });
        }}
      >
        <label className="block" htmlFor="friend-email">
          Monash email
        </label>
        <input
          id="friend-email"
          type="email"
          required
          autoComplete="off"
          className="w-full rounded border border-current/25 px-3 py-2"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button className="primary-button" type="submit" disabled={busy}>
          Send request
        </button>
      </form>
      {error && <p role="alert">{error.message}</p>}
      {notice && <output>{notice}</output>}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Friends and requests</h2>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={friends.isFetching}
        >
          Refresh
        </button>
      </div>
      {friends.isPending && <output>Loading requests…</output>}
      {friends.data?.length === 0 && <p>No friend requests yet.</p>}
      <ul className="divide-y divide-current/15">
        {friends.data?.map((friend) => (
          <li key={friend.id} className="py-4 space-y-2">
            <p className="font-semibold">{friend.user.name}</p>
            <p className="break-all">{friend.user.email}</p>
            <p>
              {friend.status === "ACCEPTED"
                ? "Friends"
                : friend.status === "DECLINED"
                  ? "Declined"
                  : friend.direction === "incoming"
                    ? "Incoming request"
                    : "Request sent — awaiting response"}
            </p>
            <div className="flex flex-wrap gap-4">
              {friend.status === "PENDING" &&
                friend.direction === "incoming" && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        respond.mutate({ id: friend.id, action: "accept" })
                      }
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        respond.mutate({ id: friend.id, action: "decline" })
                      }
                    >
                      Decline
                    </button>
                  </>
                )}
              <button
                type="button"
                disabled={busy}
                onClick={() => remove.mutate({ id: friend.id })}
              >
                {friend.status === "ACCEPTED"
                  ? "Remove friend"
                  : friend.direction === "outgoing" &&
                      friend.status === "PENDING"
                    ? "Cancel request"
                    : "Dismiss"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p>
        To match timetables, ask the planner to match a student’s name or
        student ID. It uses their most recently opened or saved timetable with
        classes for the current term.
      </p>
    </div>
  );
}
