using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using static Define;

public class UI_TapButton : UI_Buttons
{

    public override bool Init()
    {
        if (base.Init() == false)
            return false;

        return true;
    }

    public override void OnPointerDown(PointerEventData eventData)
    { 
    }
}
