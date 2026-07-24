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
    private Vector3 _dragStartWorld;
    private bool _isDragging;
    private const float MaxDrag = 5f;
    private const float LaunchPower = 12f;

    public void Tick()
    {
        if (_isGameEnd || !_started) return;

        if (Input.GetMouseButtonDown(0))
        {
            if (Camera.main == null) return;
            Ray ray = Camera.main.ScreenPointToRay(Input.mousePosition);
            if (Physics.Raycast(ray, out RaycastHit hit, 100f))
            {
                if (TrySelectPiece(hit.point, out ChessPiece piece))
                {
                    _selected = piece;
                    _dragStartWorld = hit.point;
                    _isDragging = true;
                }
            }
        }
        else if (_isDragging && Input.GetMouseButtonUp(0))
        {
            if (Camera.main == null)
            {
                _selected = null;
                _isDragging = false;
                return;
            }

            Vector3 mousePos = Input.mousePosition;
            mousePos.z = Camera.main.WorldToScreenPoint(_dragStartWorld).z;
            Vector3 releaseWorld = Camera.main.ScreenToWorldPoint(mousePos);

            Vector3 dragDir = _dragStartWorld - releaseWorld;
            dragDir.y = 0f;

            float dragLen = Mathf.Min(dragDir.magnitude, MaxDrag);
            float power = (dragLen / MaxDrag) * LaunchPower;

            LaunchPiece(_selected, dragDir, power);

            _selected = null;
            _isDragging = false;
        }
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

        SetupCamera();

        _board = Managers.Resource.Instantiate("Chessboard");
        MeasureBoard();
        if (_board != null)
            AutoSizeBoardCollider(_board);

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

    private void SetupCamera()
    {
        var cam = Camera.main;
        if (cam != null)
        {
            cam.transform.position = new Vector3(0f, 12f, -10f);
            cam.transform.rotation = Quaternion.Euler(50f, 0f, 0f);
        }
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
            float d = Vector3.Distance(p.transform.position, worldPos);
            if (d < closest)
            {
                closest = d;
                piece = p;
            }
        }

        return piece != null;
    }

    public void LaunchPiece(ChessPiece piece, Vector3 dragDir, float power)
    {
        if (piece == null || !piece.IsAlive || piece.Team != _currentTurn) return;

        Vector3 force = dragDir.normalized * power;
        Vector3 impact = piece.transform.position + new Vector3(0f, 0.3f, 0f);
        piece.Launch(force, impact);

        _currentTurn = _currentTurn == ETeam.White ? ETeam.Black : ETeam.White;
        Managers.Message.Dispatch(EGlobalEvent.TurnChanged, new EventData<ETeam>(_currentTurn));
    }

    private void OnPieceRingOut(EventData eventData)
    {
        var piece = (eventData as EventData<ChessPiece>)?.value;
        if (piece != null)
            Debug.Log($"[GameManager] Ring Out: {piece.PieceType} ({piece.Team})");
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