import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

/**
 * Handler bag for realtime chat events. Pass these in from a component
 * (Dashboard) so the hook can dispatch live DB deltas into React state.
 *
 * All handlers are optional. The hook dispatches only the events you
 * subscribe to. Handlers are kept in a ref so their identity doesn't
 * tear down the underlying Supabase channel on every render.
 */
export interface ChatRealtimeHandlers {
  /** Fired on every new row in `public.messages`. The `row` matches the
   *  Postgres column names (`conversation_id`, `sender_id`, `created_at`,
   *  etc.) — convert to the camelCase `Message` type yourself. */
  onMessageInsert?: (row: any) => void;
  /** Fired on every DELETE in `public.messages`. */
  onMessageDelete?: (msgId: string, conversationId: string) => void;
  /** Fired on every UPDATE in `public.conversations` — typically when the
   *  server (via Socket.IO) bumps `last_message`, `last_message_at`,
   *  `last_message_sender_id`. */
  onConversationUpdate?: (row: any) => void;
  /** Fired on INSERT/DELETE in `public.participants` — typically when the
   *  current user is added to or removed from a conversation. */
  onParticipantChange?: (data: {
    conversation_id: string;
    user_id: string;
    op: 'INSERT' | 'DELETE';
  }) => void;
}

/**
 * `useRealtimeChat` opens ONE Supabase Realtime channel and attaches
 * multiple `postgres_changes` listeners to it. Realtime respects the
 * server-side RLS policy `auth.uid() IS NOT NULL AND is_participant(...)`
 * — so the client only receives events for rows it has SELECT access to.
 *
 * The channel cleans up on unmount.
 *
 * NOTE: This hook MUST be called AFTER `supabase.auth.setSession(...)`
 * has resolved, otherwise the underlying websocket connects without a
 * JWT and RLS denies all messages. The auth wiring lives in AuthContext.
 */
export function useRealtimeChat(handlers: ChatRealtimeHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const channel = supabase
      .channel('echoza-chat-db-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => handlersRef.current.onMessageInsert?.(payload.new)
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages' },
        (payload) =>
          handlersRef.current.onMessageDelete?.(
            payload.old.id,
            payload.old.conversation_id
          )
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations' },
        (payload) => handlersRef.current.onConversationUpdate?.(payload.new)
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'participants' },
        (payload) =>
          handlersRef.current.onParticipantChange?.({
            conversation_id: payload.new.conversation_id,
            user_id: payload.new.user_id,
            op: 'INSERT',
          })
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'participants' },
        (payload) =>
          handlersRef.current.onParticipantChange?.({
            conversation_id: payload.old.conversation_id,
            user_id: payload.old.user_id,
            op: 'DELETE',
          })
      );

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // Quiet success — listeners are wired.
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[realtime] echoza-chat-db-changes status:', status);
      } else if (status === 'CLOSED') {
        // Cleanup already in progress, no action needed.
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
}
