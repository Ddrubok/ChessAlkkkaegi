--------------------------- MODULE MatchCancel ---------------------------
EXTENDS Naturals

\* Source: web/src/supabase-matchmaker.ts startMatching, cancel, cleanup,
\* onConnectionEstablished. Two bounded attempts share one matcher instance.
\* JS executes synchronously until await. Cancel closes owned peer first.
CONSTANT StartWithPeer
ASSUME StartWithPeer \in BOOLEAN

VARIABLES attempt, cancelled, established, channel, pc, dc, opponent,
          dcOpen, pcConnected, cleanupStage, status, readyCount, lateReady,
          handedOff, staleDelivered
vars == <<attempt, cancelled, established, channel, pc, dc, opponent,
          dcOpen, pcConnected, cleanupStage, status, readyCount, lateReady,
          handedOff, staleDelivered>>

Init ==
  /\ attempt = 1 /\ cancelled = FALSE /\ established = FALSE
  /\ channel = TRUE /\ pc = StartWithPeer /\ dc = StartWithPeer
  /\ opponent = StartWithPeer /\ dcOpen = FALSE /\ pcConnected = FALSE
  /\ cleanupStage = "idle" /\ status = "signaling"
  /\ readyCount = 0 /\ lateReady = FALSE /\ handedOff = FALSE
  /\ staleDelivered = FALSE

\* src: setupHostWebRTC/setupGuestWebRTC, after ICE-server await.
PreparePeer ==
  /\ ~cancelled /\ ~pc /\ ~handedOff
  /\ pc' = TRUE /\ dc' = TRUE /\ opponent' = TRUE
  /\ UNCHANGED <<attempt, cancelled, established, channel, dcOpen,
                  pcConnected, cleanupStage, status, readyCount, lateReady,
                  handedOff, staleDelivered>>

\* src: cancel() -> cleanup() synchronous prefix, before channel.untrack().
Cancel ==
  /\ ~cancelled /\ ~handedOff
  /\ cancelled' = TRUE /\ channel' = FALSE
  /\ pc' = FALSE /\ dc' = FALSE /\ opponent' = FALSE
  /\ dcOpen' = FALSE /\ pcConnected' = FALSE
  /\ cleanupStage' = "untrack" /\ status' = "cancelled"
  /\ UNCHANGED <<attempt, established, readyCount, lateReady,
                  handedOff, staleDelivered>>

\* src: startMatching() can run while old untrack/remove is unresolved.
Retry ==
  /\ attempt = 1 /\ cancelled /\ ~handedOff
  /\ attempt' = 2 /\ cancelled' = FALSE /\ channel' = TRUE
  /\ established' = FALSE /\ status' = "signaling"
  /\ UNCHANGED <<pc, dc, opponent, dcOpen, pcConnected, cleanupStage,
                  readyCount, lateReady, handedOff, staleDelivered>>

\* src: detached old channel's awaited teardown; current attempt untouched.
UntrackSettles ==
  /\ cleanupStage = "untrack" /\ cleanupStage' = "remove"
  /\ UNCHANGED <<attempt, cancelled, established, channel, pc, dc,
                  opponent, dcOpen, pcConnected, status, readyCount,
                  lateReady, handedOff, staleDelivered>>
RemoveSettles ==
  /\ cleanupStage = "remove" /\ cleanupStage' = "done"
  /\ UNCHANGED <<attempt, cancelled, established, channel, pc, dc,
                  opponent, dcOpen, pcConnected, status, readyCount,
                  lateReady, handedOff, staleDelivered>>

\* src: old dc.onopen/pc.onconnectionstatechange fails identity guard.
StaleOpen ==
  /\ cleanupStage # "idle" /\ ~staleDelivered
  /\ staleDelivered' = TRUE
  /\ UNCHANGED <<attempt, cancelled, established, channel, pc, dc,
                  opponent, dcOpen, pcConnected, cleanupStage, status,
                  readyCount, lateReady, handedOff>>

\* src: onConnectionEstablished checks cancel, pc/dc/match identity and open.
DataChannelOpen ==
  /\ ~cancelled /\ pc /\ dc /\ ~dcOpen /\ ~handedOff
  /\ dcOpen' = TRUE /\ established' = TRUE /\ handedOff' = TRUE
  /\ pc' = FALSE /\ dc' = FALSE /\ status' = "connected"
  /\ readyCount' = readyCount + 1
  /\ lateReady' = lateReady \/ cancelled
  /\ UNCHANGED <<attempt, cancelled, channel, opponent, pcConnected,
                  cleanupStage, staleDelivered>>

PeerConnected ==
  /\ ~cancelled /\ pc /\ ~pcConnected /\ ~handedOff
  /\ pcConnected' = TRUE
  /\ UNCHANGED <<attempt, cancelled, established, channel, pc, dc,
                  opponent, dcOpen, cleanupStage, status, readyCount,
                  lateReady, handedOff, staleDelivered>>

Done == (cleanupStage = "done" \/ handedOff) /\ UNCHANGED vars
Next == PreparePeer \/ Cancel \/ Retry \/ UntrackSettles \/ RemoveSettles
        \/ StaleOpen \/ DataChannelOpen \/ PeerConnected \/ Done
Spec == Init /\ [][Next]_vars
        /\ WF_vars(UntrackSettles) /\ WF_vars(RemoveSettles)

TypeOK ==
  /\ attempt \in {1, 2} /\ cancelled \in BOOLEAN /\ established \in BOOLEAN
  /\ channel \in BOOLEAN /\ pc \in BOOLEAN /\ dc \in BOOLEAN
  /\ opponent \in BOOLEAN /\ dcOpen \in BOOLEAN /\ pcConnected \in BOOLEAN
  /\ cleanupStage \in {"idle", "untrack", "remove", "done"}
  /\ status \in {"signaling", "cancelled", "connected"}
  /\ readyCount \in Nat /\ lateReady \in BOOLEAN
  /\ handedOff \in BOOLEAN /\ staleDelivered \in BOOLEAN
ResourcePartition == (dc => pc) /\ (handedOff => ~pc /\ ~dc)
NoLateReady == ~lateReady
ReadyOnce == readyCount <= 1
CleanupEventually == [](cleanupStage = "untrack" => <> (cleanupStage = "done"))
CancelAwaitUntrack == cancelled /\ cleanupStage = "untrack" /\ ~pc /\ ~dc
RetryBeforeOldCleanup == attempt = 2 /\ cleanupStage = "untrack" /\ pc
StaleAfterRetry == attempt = 2 /\ staleDelivered /\ pc
NormalHandoff == handedOff /\ readyCount = 1
TerminalClosed == cancelled /\ cleanupStage = "done" /\ ~pc /\ ~dc
=============================================================================
