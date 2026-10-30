/-!
Stage lifecycle: web/src/main.ts:1621-1650,1842-1845,1957-2004;
meta.ts:684-752; game-mode.ts:19-47; match.ts:393-436.
The run has ten stages and unit payout (config.ts:256-259).
Stage inputs are exactly representable JS integers restricted to 1..10.
Nat represents these bounded values and nonnegative permanent points;
point addition assumes the JS total remains an exact safe integer.
Cards/board success is a phase transition; reset failure rolls back.
Physics, storage failure and other modes are outside the model.
-/
namespace StageDrawRestart
def runLength : Nat := 10
inductive Phase | playing | card | terminal | menu
  deriving Repr, DecidableEq
structure State where
  stageNumber : Nat
  lastClearedStage : Nat
  startedAtStage : Nat
  points : Nat
  paid : Nat
  phase : Phase
  deriving Repr, DecidableEq

/-- meta.ts:684-688. -/
def createStageRunPointState (startStage : Nat) : Option State :=
  if 1 <= startStage && startStage <= runLength then
    some { stageNumber := startStage, lastClearedStage := startStage - 1,
           startedAtStage := startStage, points := 0, paid := 0,
           phase := .playing }
  else none

/-- meta.ts:694-710, with unit contribution 1. -/
def computeStageRunPayout : Nat -> Nat
  | 0 => 0
  | n + 1 => computeStageRunPayout n + (n + 1)
def pendingPayout (s : State) : Nat :=
  computeStageRunPayout s.lastClearedStage -
    computeStageRunPayout (s.startedAtStage - 1)

/-- meta.ts:716-735 and main.ts:1958-1960. -/
def recordStageRunClear (s : State) : Option State :=
  if s.phase == .playing && 1 <= s.stageNumber &&
     s.stageNumber <= runLength && s.stageNumber == s.lastClearedStage + 1 then
    some { s with lastClearedStage := s.stageNumber,
                  phase := if s.stageNumber == runLength then .terminal else .card }
  else none

/-- main.ts:2015-2047, successful card/reset branch. -/
def selectUpgradeCard (s : State) : Option State :=
  if s.phase == .card then
    some { s with stageNumber := s.stageNumber + 1, phase := .playing }
  else none

/-- meta.ts:741-752, called for draw in main.ts:1965-1969. -/
def settleStageRunPoints (s : State) : State :=
  let payout := pendingPayout s
  { s with lastClearedStage := 0, startedAtStage := 1,
           points := s.points + payout, paid := payout, phase := .terminal }

/-- main.ts:1845 and 1965-1985; duplicate result is ignored. -/
def drawResult (s : State) : State :=
  if s.phase == .playing then settleStageRunPoints s else s
def toMenu (s : State) : State :=
  if s.phase == .terminal then { s with phase := .menu } else s

/-- main.ts:1621-1650,1999-2003; failed reset preserves old state. -/
def freshRun (s : State) (resetSucceeds : Bool) : State :=
  if s.phase == .menu && resetSucceeds then
    { s with stageNumber := 1, lastClearedStage := 0,
             startedAtStage := 1, paid := 0, phase := .playing }
  else s

theorem draw_result_once (s : State) : drawResult (drawResult s) = drawResult s := by
  unfold drawResult
  split <;> simp_all [settleStageRunPoints]

theorem failed_fresh_run_rolls_back (s : State) : freshRun s false = s := by
  simp [freshRun]

/-- The old property now starts at the actual terminal result, then enters a fresh run. -/
def RestartClearSafe (s : State) : Prop :=
  s.phase = .terminal ->
    (recordStageRunClear (freshRun (toMenu s) true)).isSome = true
instance (s : State) : Decidable (RestartClearSafe s) := by
  unfold RestartClearSafe
  infer_instance
theorem restart_clear_safe (s : State) : RestartClearSafe s := by
  unfold RestartClearSafe
  intro h
  simp [toMenu, freshRun, recordStageRunClear, h, runLength]

theorem duplicate_draw_preserves_points (s : State) :
    (drawResult (drawResult s)).points = (drawResult s).points := by
  rw [draw_result_once]
theorem draw_payout_exact (s : State) (h : s.phase = .playing) :
    (drawResult s).paid = pendingPayout s := by
  simp [drawResult, h, settleStageRunPoints]

/-- Successive white wins and card choices reach the drawn stage. -/
def runTo (startStage targetStage : Nat) : Option State := do
  let mut s <- createStageRunPointState startStage
  for _ in [:targetStage - startStage] do
    s <- recordStageRunClear s
    s <- selectUpgradeCard s
  if s.stageNumber == targetStage then some s else none

def validPairs : List (Nat × Nat) :=
  (List.range runLength).flatMap fun startIndex =>
    let startStage := startIndex + 1
    (List.range runLength).filterMap fun drawIndex =>
      let drawAt := drawIndex + 1
      if startStage <= drawAt then some (startStage, drawAt) else none

def trace (startStage drawAt : Nat) : Option (Nat × Bool × Bool × Bool × Bool) := do
  let playing <- runTo startStage drawAt
  let drawn := drawResult playing
  let duplicate := drawResult drawn
  let menu := toMenu drawn
  let failed := freshRun menu false
  let restarted := freshRun menu true
  let won <- recordStageRunClear restarted
  let expected := computeStageRunPayout (drawAt - 1) -
    computeStageRunPayout (startStage - 1)
  some (drawn.paid, drawn.phase == .terminal && menu.phase == .menu,
        drawn.points == expected && duplicate.points == expected,
        failed == menu, won.lastClearedStage == 1)

def badCases : List (Nat × Nat) :=
  validPairs.filter fun pair =>
    match trace pair.1 pair.2 with
    | some (payout, reached, exact, rollback, accepted) =>
        payout != computeStageRunPayout (pair.2 - 1) -
                    computeStageRunPayout (pair.1 - 1) ||
        !reached || !exact || !rollback || !accepted
    | none => true

#guard validPairs.length == 55
#guard (trace 1 1).isSome
#guard (trace 1 10).isSome
#guard (trace 10 10).isSome
#guard badCases.isEmpty
def differentialVectors : List String :=
  validPairs.filterMap fun pair => do
    let (payout, _, _, _, accepted) <- trace pair.1 pair.2
    some s!"stage-fixed|{pair.1}|{pair.2}|{payout}|{accepted}"
#guard differentialVectors.length == 55
#eval do
  for line in differentialVectors do
    IO.println line
end StageDrawRestart
