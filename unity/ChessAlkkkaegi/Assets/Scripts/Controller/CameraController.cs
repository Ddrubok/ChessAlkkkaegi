using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using static UnityEngine.GraphicsBuffer;

public class CameraController : MonoBehaviour
{
    private GameObject Target;
    void Start()
    {
    }

    public void TargetChange(GameObject _Target)
    {
        Target = _Target;

    }
}
