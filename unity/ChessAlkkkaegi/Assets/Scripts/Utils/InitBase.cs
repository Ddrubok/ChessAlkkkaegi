using UnityEngine;

public class InitBase : MonoBehaviour
{
	protected bool _init = false;
	protected bool _start = false;

	public virtual bool Init()
	{
		if (_init)
			return false;

		_init = true;
		return true;
	}

	public virtual bool StartInit()
	{
        if (_start)
            return false;

        _start = true;
        return true;
    }

    private void Start()
    {
		StartInit();
    }

    private void Awake()
	{
		Init();
	}
}
