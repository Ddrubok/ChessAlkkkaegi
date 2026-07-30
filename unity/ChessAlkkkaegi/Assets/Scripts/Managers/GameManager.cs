using System.Collections.Generic;
using UnityEngine;
using static Define;

// ponytail: simple flick + ring-out. Magnus spin, piece abilities, meta, dynamic board later.
public class GameManager
{
    private GameObject _board;
    private float _boardSize;
    private float _squareSize;
    private float _boardSurfaceY;
    private float _boardCenterX;
    private float _boardCenterZ;
    private readonly List<ChessPiece> _pieces = new();
    private readonly Dictionary<EChessPieceType, float> _massTable = new()
    {
        { EChessPieceType.Pawn,   1.0f },
        { EChessPieceType.Knight, 2.0f },
        { EChessPieceType.Bishop, 2.0f },
        { EChessPieceType.Rook,   3.5f },
        { EChessPieceType.Queen,  3.0f },
        { EChessPieceType.King,   2.5f },
    };

    private ETeam _currentTurn = ETeam.White;
    private bool _isGameEnd;
    private bool _started;

    public void Init() { }
    public void Save() { PlayerPrefs.Save(); }

    private ChessPiece _selected;
    private ChessPiece _launched;
    private float _ringOutTimer; // ponytail: let player watch the ring-out fall before ending turn.
    // ponytail: strike point on board where drag began, relative to piece center drives spin.
    private Vector3 _strikePoint;
    private Vector3 _aimStart;
    // ponytail: arrow-shaped aim. Thick shaft, thin head tip. Off until a piece is selected.
    private LineRenderer _aim;
    private void EnsureAim()
    {
        if (_aim != null) return;
        var go = new GameObject("AimArrow");
        _aim = go.AddComponent<LineRenderer>();
        _aim.positionCount = 2;
        _aim.startWidth = _squareSize * 0.12f;
        _aim.endWidth = _squareSize * 0.03f;
        _aim.numCapVertices = 3;
        var sh = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color");
        _aim.material = new Material(sh);
        _aim.enabled = false;
    }
    private bool _isDragging;
    private const float MaxDrag = 5f;
    // ponytail: web ChessAlkkagi tuning: maxLaunchSpeed=11, power 0..1 * speed.
    private const float MaxLaunchSpeed = 11f;

    // ponytail: ground-plane picking so zoom/FOV never breaks selection or aiming.
    private bool MouseToBoard(out Vector3 p)
    {
        p = Vector3.zero;
        var cam = Camera.main;
        if (cam == null) return false;
        Ray ray = cam.ScreenPointToRay(Input.mousePosition);
        Plane plane = new Plane(Vector3.up, new Vector3(0f, _boardSurfaceY, 0f));
        if (plane.Raycast(ray, out float enter)) { p = ray.GetPoint(enter); return true; }
        return false;
    }

    public void Tick()
    {
        if (_isGameEnd || !_started) return;
        if (Camera.main == null) return;
        EnsureAim();


        // ponytail: wait until launched piece stops, then flip turn.
        if (_launched != null)
        {
            // ponytail: ring-out path — piece already deactivated, let camera watch the fall ~1s then end.
            if (!_launched.IsAlive)
            {
                _ringOutTimer += Time.deltaTime;
                // ponytail: stop tracking once ringed out — just wait for the timer to end turn.
                if (_ringOutTimer >= 1f) { _ringOutTimer = 0f; EndTurn(); }
                return;
            }
            TrackLaunched();
            // ponytail: piece stopped on board — end turn now.
            if (_launched.Rigidbody.linearVelocity.sqrMagnitude < 0.01f)
                EndTurn();
            else return; // piece still flying, block input
        }
        // ponytail: arrow shows only after a piece is selected, while dragging.
        if (_isDragging && _selected != null && MouseToBoard(out Vector3 cur))
        {
            cur.y = 0f;
            Vector3 d = _aimStart - cur;
            float len = Mathf.Min(d.magnitude, MaxDrag);
            Vector3 dir = d.sqrMagnitude > 0.0001f ? d.normalized : Vector3.zero;
            Vector3 origin = _selected.transform.position; origin.y = _boardSurfaceY + 0.05f;
            _aim.SetPosition(0, origin);
            _aim.SetPosition(1, origin + dir * (len + _squareSize * 0.5f));
            _aim.startColor = Color.Lerp(Color.white, Color.red, len / MaxDrag);
            _aim.endColor = Color.Lerp(Color.white, Color.red, len / MaxDrag);
            _aim.enabled = true;
        }

        if (Input.GetMouseButtonDown(0))
        {
            if (!MouseToBoard(out Vector3 hit)) return;

            if (_selected == null)
            {
                // phase 1: tap a piece of the current team to select + zoom in.
                if (TrySelectPiece(hit, out ChessPiece piece))
                {
                    if (_selected != null) _selected.SetSelected(false);
                    _selected = piece;
                    _selected.SetSelected(true);
                    ZoomToPiece(piece);
                }
            }
            else
            {
                // phase 2: press to start aiming (pull-back flick).
                _strikePoint = hit; _strikePoint.y = 0f;
                _aimStart = hit; _aimStart.y = 0f;
                _isDragging = true;
            }
        }
        else if (_isDragging && Input.GetMouseButtonUp(0))
        {
            if (!MouseToBoard(out Vector3 hit))
            {
                _aim.enabled = false;
                _isDragging = false;
                return;
            }

            Vector3 aimEnd = hit; aimEnd.y = 0f;
            Vector3 dir = _aimStart - aimEnd;
            float dragLen = Mathf.Min(dir.magnitude, MaxDrag);

            // ponytail: a tap (no drag) cancels selection instead of a zero-power launch ending the turn.
            if (dragLen < 0.01f)
            {
                _aim.enabled = false;
                _selected.SetSelected(false);
                _selected = null;
                _isDragging = false;
                SetupCamera(_currentTurn);
                return;
            }

            float power = dragLen / MaxDrag;
            _aim.enabled = false;
            _selected.SetSelected(false);
            Debug.Log($"[GameManager] Drag start={_aimStart} end={aimEnd} rawDir={_aimStart - aimEnd} dragLen={dragLen} power={power:F2}");
            // ponytail: contact offset from center × launch dir = torque. Strike right, go forward → spin right.
            Vector3 toContact = _strikePoint - _selected.transform.position; toContact.y = 0f;
            float spin = Vector3.SignedAngle(toContact, dir, Vector3.up) * power * 0.5f;
            LaunchPiece(_selected, dir, power, spin);

            _selected = null;
            _isDragging = false;
        }
    }

    // ponytail: zoom toward piece from current turn side. No hard-coded -Z.
    private void ZoomToPiece(ChessPiece piece)
    {
        var cam = Camera.main;
        if (cam == null) return;

        Vector3 p = piece.transform.position;
        float sgn = _currentTurn == ETeam.White ? -1f : 1f;
        float dist = Mathf.Max(_boardSize, 1f) * 0.5f;
        cam.transform.position = p + new Vector3(0f, dist * 0.8f, sgn * dist * 0.8f);
        cam.transform.LookAt(p);
    }

    // ponytail: follow launched piece during flight so player sees the hit before turn flips.
    private void TrackLaunched()
    {
        var cam = Camera.main;
        if (cam == null || _launched == null) return;
        Vector3 p = _launched.transform.position;
        // ponytail: don't chase the piece below the board — clamp target to board surface.
        p.y = Mathf.Max(p.y, _boardSurfaceY);
        float dist = Mathf.Max(_boardSize, 1f) * 0.6f;
        cam.transform.position = Vector3.Lerp(cam.transform.position, p + new Vector3(0f, dist, 0f), 0.1f);
        cam.transform.LookAt(p);
        Debug.Log($"[GameManager] Track pos={p} v={_launched.Rigidbody.linearVelocity}");
    }

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
    private static void AutoInit()
    {
        Managers.Init();
    }

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void AutoStart()
    {
        Managers.Game.StartGame();
    }

    public void StartGame()
    {
        if (_started) return;
        _started = true;

        _isGameEnd = false;
        _currentTurn = ETeam.White;

        _board = Managers.Resource.Instantiate("Chessboard");
        MeasureBoard();
        if (_board != null)
            AutoSizeBoardCollider(_board);

        SetupCamera(_currentTurn);

        // 8x8 grid: file 0..7 (a..h), rank 0..7. White on ranks 0-1, Black on 6-7.
        int wy = 0;
        PlaceTeamLine(ETeam.White, wy);
        PlaceTeamLine(ETeam.White, wy + 1, pawns: true);
        PlaceTeamLine(ETeam.Black, 7);
        PlaceTeamLine(ETeam.Black, 6, pawns: true);

        Managers.Message.Register(EGlobalEvent.PieceRingOut, OnPieceRingOut);
        Managers.Message.Dispatch(EGlobalEvent.TurnChanged, new EventData<ETeam>(_currentTurn));

    }

    private void MeasureBoard()
    {
        if (_board == null) return;
        var rend = _board.GetComponentInChildren<Renderer>();
        if (rend == null) return;

        Bounds b = rend.bounds;
        _boardSize = Mathf.Max(b.size.x, b.size.z);
        _squareSize = _boardSize / 8f;
        _boardSurfaceY = b.max.y;
        _boardCenterX = b.center.x;
        _boardCenterZ = b.center.z;
    }

    private Vector3 GridToWorld(int file, int rank)
    {
        float half = _boardSize * 0.5f - _squareSize * 0.5f;
        float x = _boardCenterX - half + file * _squareSize;
        float z = _boardCenterZ - half + rank * _squareSize;
        return new Vector3(x, _boardSurfaceY, z);
    }

    private void PlaceTeamLine(ETeam team, int rank, bool pawns = false)
    {
        if (pawns)
        {
            for (int f = 0; f < 8; f++)
                Spawn(team, EChessPieceType.Pawn, GridToWorld(f, rank));
            return;
        }

        Spawn(team, EChessPieceType.Rook,   GridToWorld(0, rank));
        Spawn(team, EChessPieceType.Knight,  GridToWorld(1, rank));
        Spawn(team, EChessPieceType.Bishop,  GridToWorld(2, rank));
        Spawn(team, EChessPieceType.Queen,   GridToWorld(3, rank));
        Spawn(team, EChessPieceType.King,    GridToWorld(4, rank));
        Spawn(team, EChessPieceType.Bishop,  GridToWorld(5, rank));
        Spawn(team, EChessPieceType.Knight,  GridToWorld(6, rank));
        Spawn(team, EChessPieceType.Rook,    GridToWorld(7, rank));
    }

    private void AutoSizeBoardCollider(GameObject board)
    {
        var rend = board.GetComponentInChildren<Renderer>();
        var bc = Util.GetOrAddComponent<BoxCollider>(board);
        if (rend == null) return;

        Bounds b = rend.bounds;
        Vector3 lossy = board.transform.lossyScale;
        bc.center = board.transform.InverseTransformPoint(b.center);
        bc.size = new Vector3(
            b.size.x / Mathf.Max(Mathf.Abs(lossy.x), 0.0001f),
            Mathf.Max(b.size.y, 0.5f) / Mathf.Max(Mathf.Abs(lossy.y), 0.0001f),
            b.size.z / Mathf.Max(Mathf.Abs(lossy.z), 0.0001f));
    }

    // ponytail: web-style 48deg pitch, board-fit distance. No extreme zoom-in/out.
    private void SetupCamera(ETeam team)
    {
        var cam = Camera.main;
        if (cam == null) return;

        float sgn = team == ETeam.White ? -1f : 1f;
        float dist = Mathf.Max(_boardSize, 1f) * 0.75f;
        cam.transform.position = new Vector3(_boardCenterX, dist, _boardCenterZ + sgn * dist);
        cam.transform.LookAt(new Vector3(_boardCenterX, _boardSurfaceY, _boardCenterZ));
    }
    private void Spawn(ETeam team, EChessPieceType type, Vector3 gridPos)
    {
        GameObject go = Managers.Resource.Instantiate($"chessPieces/{type}");
        if (go == null) return;

        ChessPiece piece = Util.GetOrAddComponent<ChessPiece>(go);
        piece.Setup(type, team, gridPos, _massTable[type], _squareSize);
        _pieces.Add(piece);
    }

    public bool TrySelectPiece(Vector3 worldPos, out ChessPiece piece)
    {
        piece = null;
        if (_isGameEnd) return false;

        float closest = _squareSize * 0.7f;
        foreach (ChessPiece p in _pieces)
        {
            if (!p.IsAlive || p.Team != _currentTurn) continue;
            // ponytail: XZ-only distance so picking the top of a tall piece still selects it.
            Vector3 pp = p.transform.position; pp.y = worldPos.y;
            float d = Vector3.Distance(pp, worldPos);
            if (d < closest)
            {
                closest = d;
                piece = p;
            }
        }

        return piece != null;
    }

    // ponytail: web-style velocity launch. power 0..1 * MaxLaunchSpeed.
    // ponytail: launch only. Turn flips when the piece stops or rings out, not on launch.
    public void LaunchPiece(ChessPiece piece, Vector3 dir, float power, float spin)
    {
        if (piece == null || !piece.IsAlive || piece.Team != _currentTurn) return;

        Vector3 v = dir.normalized * Mathf.Clamp01(power) * MaxLaunchSpeed;
        // ponytail: only the launched piece goes dynamic. Others wake on collision via ChessPiece.OnCollisionEnter.
        piece.Launch(v, spin);
        Debug.Log($"[GameManager] LaunchPiece {piece.PieceType}({piece.Team}) power={power:F2} spin={spin:F1} dir={dir} dirNormalized={dir.normalized} worldDir={dir.normalized * Mathf.Clamp01(power) * MaxLaunchSpeed}");
        _launched = piece;
    }

    // ponytail: one guard in the shared function. Ring-out path waits via timer in Tick.
    private void EndTurn()
    {
        if (_launched == null) return;
        // ponytail: re-sleep all pieces for the next turn.
        foreach (ChessPiece p in _pieces)
            if (p.IsAlive) p.FreezePhysics();
        _launched = null;
        _currentTurn = (_currentTurn == ETeam.White) ? ETeam.Black : ETeam.White;
        Managers.Message.Dispatch(EGlobalEvent.TurnChanged, new EventData<ETeam>(_currentTurn));
        SetupCamera(_currentTurn);
    }

    private void OnPieceRingOut(EventData eventData)
    {
        var piece = (eventData as EventData<ChessPiece>)?.value;
        if (piece == null) return;
        Debug.Log($"[GameManager] Ring Out: {piece.PieceType} ({piece.Team})");
        // ponytail: don't end turn here — let Tick keep tracking the fall, then EndTurn when _launched clears.
        CheckWinCondition();
    }

    private void CheckWinCondition()
    {
        bool whiteKingAlive = _pieces.Exists(p => p.Team == ETeam.White && p.PieceType == EChessPieceType.King && p.IsAlive);
        bool blackKingAlive = _pieces.Exists(p => p.Team == ETeam.Black && p.PieceType == EChessPieceType.King && p.IsAlive);

        if (!whiteKingAlive || !blackKingAlive)
        {
            _isGameEnd = true;
            ETeam winner = whiteKingAlive ? ETeam.White : ETeam.Black;
            Managers.Message.Dispatch(EGlobalEvent.GameEnd, new EventData<ETeam>(winner));
            Debug.Log($"[GameManager] Game End - Winner: {winner}");
        }
    }

    public void Clear()
    {
        Managers.Message.UnRegister(EGlobalEvent.PieceRingOut, OnPieceRingOut);

        foreach (ChessPiece p in _pieces)
        {
            if (p != null && p.gameObject != null)
                Managers.Resource.Destroy(p.gameObject);
        }
        _pieces.Clear();

        if (_board != null)
            Managers.Resource.Destroy(_board);

        _started = false;
    }
}
