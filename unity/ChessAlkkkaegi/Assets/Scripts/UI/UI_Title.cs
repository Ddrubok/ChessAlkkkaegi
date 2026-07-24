using System.Collections;
using System.Collections.Generic;
using TMPro;
using Unity.VisualScripting;
using UnityEngine;
using static Define;

public class UI_Title : UI_Base
{

    enum Text
    {
        TapName,
        Gold,
    }
    private TextMeshProUGUI _tapName;
    private TextMeshProUGUI _gold;

    public override bool Init()
    {
        if (base.Init() == false)
            return false;
        BindTextMeshs(typeof(Text));

        _tapName = GetTextMesh((int)Text.TapName);
        _gold = GetTextMesh((int)Text.Gold);
        return true;
    }

  

    private void HandleOnGoldChanged(ulong gt)
    {
        _gold.text = Util.ConvertToCurrencyFormat(gt);
    }
}
