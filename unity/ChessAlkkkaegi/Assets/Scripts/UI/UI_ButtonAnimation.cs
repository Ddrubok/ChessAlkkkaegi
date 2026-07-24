
using DG.Tweening;
using UnityEngine;
using UnityEngine.EventSystems;

public class UI_ButtonAnimation : MonoBehaviour
{
    private void Start()
    {
        gameObject.BindEvent(ButtonPointerDownAnimation, type: Define.EUIEvent.PointerDown);
        gameObject.BindEvent(ButtonPointerUpAnimation, type: Define.EUIEvent.PointerUp);
    }

    public void ButtonPointerDownAnimation(PointerEventData evt)
    {
		transform.DOScale(0.85f, 0.1f).SetEase(Ease.InOutBack).SetUpdate(true);
	}

    public void ButtonPointerUpAnimation(PointerEventData evt)
    {
		transform.DOScale(1f, 0.1f).SetEase(Ease.InOutSine).SetUpdate(true);
	}
}
