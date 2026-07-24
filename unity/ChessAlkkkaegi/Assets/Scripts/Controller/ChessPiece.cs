using UnityEngine;
using static Define;

// ponytail: simplified collision/mass. Magnus spin, piece abilities, dynamic board later.
public class ChessPiece : BaseController
{
    public EChessPieceType PieceType { get; private set; }
    public ETeam Team { get; private set; }
    public Rigidbody Rigidbody { get; private set; }
    public bool IsAlive { get; private set; } = true;

    private const float RingOutY = -2f;

    public void Setup(EChessPieceType type, ETeam team, Vector3 gridPos, float mass, float squareSize)
    {
        PieceType = type;
        Team = team;

        Rigidbody = Util.GetOrAddComponent<Rigidbody>(gameObject);
        Rigidbody.mass = mass;
        Rigidbody.linearDamping = 0.5f;
        Rigidbody.angularDamping = 0.5f;
        Rigidbody.centerOfMass = new Vector3(0f, -0.3f, 0f);
        Rigidbody.collisionDetectionMode = CollisionDetectionMode.Continuous;
        Rigidbody.constraints = RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationZ;
        Rigidbody.isKinematic = true;

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

    public void Launch(Vector3 force, Vector3 impactPoint)
    {
        if (!IsAlive) return;
        Rigidbody.isKinematic = false;
        Rigidbody.AddForceAtPosition(force, impactPoint, ForceMode.Impulse);
    }

    private void OnCollisionEnter(Collision collision)
    {
        var other = collision.gameObject.GetComponent<ChessPiece>();
        if (other == null) return;

        // kinematic piece unfreezes when hit by a dynamic (launched) piece
        if (Rigidbody.isKinematic && !other.Rigidbody.isKinematic)
        {
            Rigidbody.isKinematic = false;
            Vector3 normal = collision.GetContact(0).normal;
            Rigidbody.AddForce(-normal * other.Rigidbody.linearVelocity.magnitude * 0.5f, ForceMode.Impulse);
        }
    }

    public override void UpdateController()
    {
        if (!IsAlive) return;
        if (transform.position.y < RingOutY)
        {
            IsAlive = false;
            Managers.Message.Dispatch(EGlobalEvent.PieceRingOut, new EventData<ChessPiece>(this));
            gameObject.SetActive(false);
        }
    }
}