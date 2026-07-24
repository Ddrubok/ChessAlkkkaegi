using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using static Define;

public class UI_Tap : UI_Base
{

    enum GameObjects
    {
        Resources,
        Gotcha,
        Enhance,
    }

    public override bool Init()
    {
        if (base.Init() == false)
            return false;
        BindObjects(typeof(GameObjects));


        return true;
    }

    void ChangeTap(int n)
    {
        CloseAllTap();
        GetObject(n).SetActive(true);
    }

    void CloseAllTap()
    {
        for (int i = 0; i <= (int)GameObjects.Enhance; i++)
        {
            GetObject(i).SetActive(false);
        }
    }
}
