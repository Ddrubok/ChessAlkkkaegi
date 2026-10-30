/-!
Stage draw and restart, transcribed from web/src/main.ts:1611-1641, 1945-2058,
web/src/meta.ts:682-766, web/src/game-mode.ts:21-69, and
web/src/match.ts:60-75, 154-192, 295-352, and web/src/turn.ts:1005-1016.
The shipped run length is 10
(web/src/config.ts:256). JavaScript inputs are integers in 0..10; Nat is used
only inside these validated bounds. A draw is possible when both sides have
zero pieces. Board physics, cards, storage, and async reset failure are outside
this model. The modeled restart follows the successful resetBoard path.
-/

namespace StageDrawRestart

def runLength : Nat := 10

inductive Phase | playing | card | result | ended
  deriving Repr, DecidableEq

structure State where
  stageNumber : Nat
  lastClearedStage : Nat
  startedAtStage : Option Nat
  phase : Phase
  deriving Repr, DecidableEq

/-- meta.ts:682-688, with game-mode.ts:38-42 setting the selected stage. -/
def createStageRunPointState (startStage : Nat) : Option State :=
  if 1 ≤ startStage && startStage ≤ runLength then
    some { stageNumber := startStage,
           lastClearedStage := startStage - 1,
           startedAtStage := if startStage == 1 then none else some startStage,
           phase := .playing }
  else none

/-- meta.ts:716-735, then main.ts:1945-1982. -/
def recordStageRunClear (s : State) : Except String State :=
  if s.phase != .playing then .error "not playing"
  else if !(1 ≤ s.stageNumber && s.stageNumber ≤ runLength) then .error "stage out of range"
  else if s.stageNumber != s.lastClearedStage + 1 then .error "stage clear order"
  else if s.stageNumber == runLength then
    .ok { s with lastClearedStage := 0, startedAtStage := none, phase := .ended }
  else .ok { s with lastClearedStage := s.stageNumber, phase := .card }

/-- main.ts:2030-2053, successful card selection and board reset. -/
def selectUpgradeCard (s : State) : Option State :=
  if s.phase == .card then
    some { s with stageNumber := s.stageNumber + 1, phase := .playing }
  else none

/-- match.ts:60-75 supplies draw; main.ts:1945-1974 does not settle it. -/
def drawResult (s : State) : Option State :=
  if s.phase == .playing then some { s with phase := .result } else none

/-- main.ts:1975-2007 resets stage/cards/board, but not stageRunPoints. -/
def restartAfterResult (s : State) : Option State :=
  if s.phase == .result then
    some { s with stageNumber := 1, phase := .playing }
  else none

/-- main.ts:1959-1970 and meta.ts:741-750 on a black win. -/
def settleLoss (s : State) : Option State :=
  if s.phase == .playing then
    some { s with lastClearedStage := 0, startedAtStage := none, phase := .ended }
  else none

/-- Advance through ordinary white wins and card choices to a later stage. -/
def runTo (startStage targetStage : Nat) : Option State := do
  let mut s ← createStageRunPointState startStage
  for _ in [:targetStage - startStage] do
    s ← (recordStageRunClear s).toOption
    s ← selectUpgradeCard s
  if s.stageNumber == targetStage then some s else none

/-- Desired safety: after any reachable draw and restart, stage 1 can clear. -/
def RestartClearSafe (startStage targetStage : Nat) : Prop :=
  ∀ s, runTo startStage targetStage = some s →
    ∀ drawn, drawResult s = some drawn →
      ∀ restarted, restartAfterResult drawn = some restarted →
        (recordStageRunClear restarted).isOk = true

instance (startStage targetStage : Nat) : Decidable (RestartClearSafe startStage targetStage) := by
  unfold RestartClearSafe
  infer_instance

/-- Exhaustive start/draw-stage pairs within shipped stages 1..10. -/
def badCases : List (Nat × Nat × Nat) :=
  (List.range runLength).flatMap fun startIndex =>
    let startStage := startIndex + 1
    (List.range runLength).filterMap fun targetIndex =>
      let targetStage := targetIndex + 1
      if targetStage < startStage then none else do
        let s ← runTo startStage targetStage
        let drawn ← drawResult s
        let restarted ← restartAfterResult drawn
        match recordStageRunClear restarted with
        | .error _ => some (startStage, targetStage, restarted.lastClearedStage)
        | .ok _ => none

#guard (runTo 1 2).isSome
#guard (runTo 1 10).isSome
#guard (runTo 10 10).isSome
#guard ((runTo 1 10).bind (fun s => (recordStageRunClear s).toOption)).isSome
#guard ((runTo 1 2).bind settleLoss).isSome
#eval badCases.length
#eval badCases.take 12
#eval badCases.filter (fun case => case.1 == 1)

-- Additional diagnostic vectors for comparison with the production callback.
-- This does not weaken or change the frozen safety property below.
def differentialVectors : List String :=
  (List.range runLength).flatMap fun startIndex =>
    let startStage := startIndex + 1
    (List.range runLength).filterMap fun targetIndex =>
      let targetStage := targetIndex + 1
      if targetStage < startStage then none else do
        let s ← runTo startStage targetStage
        let drawn ← drawResult s
        let restarted ← restartAfterResult drawn
        let accepted := (recordStageRunClear restarted).isOk
        return s!"stage-vector|{startStage}|{targetStage - startStage}|{accepted}"

#eval differentialVectors
#guard badCases.isEmpty

/-- The expected invariant is deliberately left as a check, not changed to pass. -/
theorem normal_start_restart_clear_safe : RestartClearSafe 1 2 := by
  decide

end StageDrawRestart
