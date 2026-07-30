using UnityEngine;
using static Define;

// ponytail: simplified collision/mass. Magnus spin, piece abilities, dynamic board later.
public class ChessPiece : BaseController
{
    public EChessPieceType PieceType { get; private set; }
    public ETeam Team { get; private set; }
    public Rigidbody Rigidbody { get; private set; }
    public bool IsAlive { get; private set; } = true;
    private bool _isLaunched;

    private const float RingOutY = -2f;
    private GameObject _outline;
    private static Material _outlineMat;

    public void Setup(EChessPieceType type, ETeam team, Vector3 gridPos, float mass, float squareSize)
    {
        PieceType = type;
        Team = team;

        Rigidbody = Util.GetOrAddComponent<Rigidbody>(gameObject);
        // ponytail: tuned to web ChessAlkkagi. velocity-launch, not force-impulse.
        Rigidbody.mass = mass;
        Rigidbody.linearDamping = 2f;
        Rigidbody.angularDamping = 2f;
        Rigidbody.centerOfMass = new Vector3(0f, -0.3f, 0f);
        Rigidbody.collisionDetectionMode = CollisionDetectionMode.Continuous;
        Rigidbody.interpolation = RigidbodyInterpolation.Interpolate;
        // ponytail: kinematic at rest = guaranteed no scatter. Launch switches all to dynamic for collisions.
        Rigidbody.useGravity = false;
        Rigidbody.isKinematic = true;
        Rigidbody.constraints = RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationZ;

        var bc = GetComponent<Collider>();
        if (bc != null) bc.material = new PhysicsMaterial { staticFriction = 0.4f, dynamicFriction = 0.4f, bounciness = 0.1f };

        NormalizeScale(squareSize);
        AutoSizeCollider();
        SetFacing(team, type);
        TintTeamColor(team);
        RestOnSurface(gridPos);
    }

    private void NormalizeScale(float squareSize)
    {
        var rend = GetComponentInChildren<Renderer>();
        if (rend == null) return;
        float xz = Mathf.Max(rend.bounds.size.x, rend.bounds.size.z);
        if (xz < 0.0001f) return;
        transform.localScale *= (squareSize * 0.6f) / xz;
    }
    private void AutoSizeCollider()
    {
        var rend = GetComponentInChildren<Renderer>();
        var bc = Util.GetOrAddComponent<BoxCollider>(gameObject);
        if (rend == null) return;

        Bounds b = rend.bounds;
        Vector3 lossy = transform.lossyScale;
        bc.center = transform.InverseTransformPoint(b.center);
        bc.size = new Vector3(
            b.size.x / Mathf.Max(Mathf.Abs(lossy.x), 0.0001f),
            b.size.y / Mathf.Max(Mathf.Abs(lossy.y), 0.0001f),
            b.size.z / Mathf.Max(Mathf.Abs(lossy.z), 0.0001f));
    }

    private void SetFacing(ETeam team, EChessPieceType type)
    {
        float y = (team == ETeam.White) ? 0f : 180f;
        if (type == EChessPieceType.Knight)
            y += 90f;
        transform.rotation = Quaternion.Euler(0f, y, 0f);
    }

    private void TintTeamColor(ETeam team)
    {
        var rend = GetComponentInChildren<Renderer>();
        if (rend == null) return;
        rend.material.color = team == ETeam.Black
            ? new Color(0.15f, 0.15f, 0.15f)
            : new Color(0.9f, 0.9f, 0.85f);
    }

    private void RestOnSurface(Vector3 gridPos)
    {
        var bc = GetComponent<BoxCollider>();
        if (bc != null)
        {
            float ly = Mathf.Abs(transform.lossyScale.y);
            float bottomLocal = bc.center.y - bc.size.y * 0.5f;
            gridPos.y = gridPos.y - bottomLocal * ly;
        }
        transform.position = gridPos;
    }

    // ponytail: runtime mesh-clone outline. URP Unlit shader, no asset/shader files. Replace with stencil outline if masking artifacts appear.
    public void SetSelected(bool on)
    {
        if (_outline == null)
        {
            var mf = GetComponentInChildren<MeshFilter>();
            if (mf == null) return;
            var src = mf.gameObject;
            _outline = new GameObject("Outline");
            _outline.transform.SetParent(src.transform.parent, false);
            _outline.transform.localPosition = src.transform.localPosition;
            _outline.transform.localRotation = src.transform.localRotation;
            _outline.transform.localScale = src.transform.localScale * 1.15f;
            var nmf = _outline.AddComponent<MeshFilter>(); nmf.sharedMesh = mf.sharedMesh;
            var nr = _outline.AddComponent<MeshRenderer>();
            if (_outlineMat == null)
            {
                var sh = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color");
                _outlineMat = new Material(sh);
                _outlineMat.color = new Color(1f, 0.2f, 0.2f);
                _outlineMat.SetInt("_Cull", 1); // cull front -> render back faces = silhouette ring
                _outlineMat.SetInt("_ZWrite", 1); _outlineMat.renderQueue = 2000;
            }
            nr.material = _outlineMat;
        }
        _outline.SetActive(on);
    }

    // ponytail: velocity-set launch matching web version (power*maxSpeed). Mass-based impulse later.
    // ponytail: strike-point offset drives Y-axis spin (Magnus). spin>0 = curve right, <0 = left.
    public void Launch(Vector3 velocity, float spin)
    {
        if (!IsAlive) return;
        _isLaunched = true;
        ActivatePhysics();
        Rigidbody.linearVelocity = velocity;
        Rigidbody.angularVelocity = new Vector3(0f, spin, 0f);
        Debug.Log($"[ChessPiece] Launch {PieceType}({Team}) v={velocity} spin={spin} pos={transform.position}");
    }

    // ponytail: switch to dynamic + gravity. Called by Launch (launched piece) and OnCollisionEnter (hit piece).
    public void ActivatePhysics()
    {
        Rigidbody.isKinematic = false;
        Rigidbody.useGravity = true;
        Rigidbody.linearVelocity = Vector3.zero;
        Rigidbody.angularVelocity = Vector3.zero;
    }

    public void FreezePhysics()
    {
        Rigidbody.linearVelocity = Vector3.zero;
        Rigidbody.angularVelocity = Vector3.zero;
        Rigidbody.isKinematic = true;
        Rigidbody.useGravity = false;
        _isLaunched = false;
    }

    // ponytail: when a launched piece hits us, become dynamic + transfer impact velocity so we get knocked.
    private void OnCollisionEnter(Collision collision)
    {
        if (!IsAlive || _isLaunched) return;
        var other = collision.gameObject.GetComponent<ChessPiece>();
        if (other == null || !other._isLaunched) return;
        // ponytail: wake this piece — dynamic + gravity, then physics solver pushes it.
        ActivatePhysics();
        Debug.Log($"[ChessPiece] Hit {PieceType}({Team}) by {other.PieceType}({other.Team}) impulse={collision.impulse}");
    }

    // ponytail: ring-out check. Fires PieceRingOut once, then deactivates.
    public override void UpdateController()
    {
        if (IsAlive && transform.position.y < RingOutY)
        {
            IsAlive = false;
            gameObject.SetActive(false);
            Managers.Message.Dispatch(EGlobalEvent.PieceRingOut, new EventData<ChessPiece>(this));
        }
    }
}
