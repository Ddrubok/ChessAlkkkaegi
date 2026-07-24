using System.Collections.Generic;
using UnityEngine;
using static Define;

public class GameScene : BaseScene
{
    [SerializeField]
    private GameObject canvas;
    public override bool Init()
    {
        if (base.Init() == false)
            return false;
        Managers.Data.Init();

        Managers.Sound.Play(ESound.Bgm, "Bgm");

        canvas.SetActive(true);
        return true;
    }

    private void Start()
    {
        SceneDataInit();
    }

    private void SceneDataInit()
    {
        Managers.Game.StartGame();
    }
    void DebugLog()
    {
        //{
        //    int MPower = 0;
        //    if (Managers.Object.Item.ContainsKey(ItemType.Weapon))
        //    {
        //        foreach (var a in Managers.Object.Item[ItemType.Weapon])
        //        {
        //            MPower += a.Value.Power;
        //        }
        //    }
        //    if ((ulong)MPower == Managers.Game.AbsoluteAttackValue)
        //        Debug.Log($"더한값 : {MPower} 절대 공격력: {Managers.Game.AbsoluteAttackValue} / 공격 배수량: {Managers.Game.AttMagnification} / 캐릭터 공격력: {Managers.Game.CharacterAttack}");
        //    else
        //        Debug.LogWarning($"더한값 : {MPower} 절대 공격력: {Managers.Game.AbsoluteAttackValue} / 공격 배수량: {Managers.Game.AttMagnification} / 캐릭터 공격력: {Managers.Game.CharacterAttack}");
        //}

        //{
        //    int MPower = 0;
        //    if (Managers.Object.Item.ContainsKey(ItemType.Armor))
        //    {
        //        foreach (var a in Managers.Object.Item[ItemType.Armor])
        //        {
        //            MPower += a.Value.Power;
        //        }
        //    }
        //    if ((ulong)MPower == Managers.Game.AbsoluteHPValue)
        //        Debug.Log($"더한값 : {MPower} 절대 HP: {Managers.Game.AbsoluteHPValue} / 공격 배수량: {Managers.Game.HPMagnification} / 캐릭터 공격력: {Managers.Game.CharacterHP}");
        //    else
        //        Debug.LogWarning($"더한값 : {MPower} 절대 HP: {Managers.Game.AbsoluteHPValue} / 공격 배수량: {Managers.Game.HPMagnification} / 캐릭터 공격력: {Managers.Game.CharacterHP}");
        //}

        //{
        //    int MPower = 0;
        //    if (Managers.Object.Item.ContainsKey(ItemType.Shield))
        //    {
        //        foreach (var a in Managers.Object.Item[ItemType.Shield])
        //        {
        //            MPower += a.Value.Power;
        //        }
        //    }
        //    if ((ulong)MPower == Managers.Game.AbsoluteShiledValue)
        //        Debug.Log($"더한값 : {MPower} 절대 방어력: {Managers.Game.AbsoluteShiledValue} / 공격 배수량: {Managers.Game.ShiledMagnification} / 캐릭터 공격력: {Managers.Game.CharacterShiled}");
        //    else
        //        Debug.LogWarning($"더한값 : {MPower} 절대 방어력: {Managers.Game.AbsoluteShiledValue} / 공격 배수량: {Managers.Game.ShiledMagnification} / 캐릭터 공격력: {Managers.Game.CharacterShiled}");
        //}
    }

    private void Update()
    {
        // Input handled in GameManager.Tick via Managers.Update
    }
    public override void Clear()
    {
        Managers.Game.Clear();
    }
}
