using JetBrains.Annotations;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public static class Define
{

    public enum EGlobalEvent
    {
        TurnChanged,
        PieceRingOut,
        GameEnd,
    }

    public enum EChessPieceType
    {
        Pawn,
        Knight,
        Bishop,
        Rook,
        Queen,
        King,
    }

    public enum ETeam
    {
        White,
        Black,
    }
    public enum CatState
    {
        IDLE_SIT,       // 기본 앉기
        IDLE_GROOMING,  // 그루밍
        IDLE_LOAF,      // 식빵
        SLEEP,          // 잠
        LISTENING,      // 듣는 중
        THINKING,       // 생각 중
        TALKING,        // 말하는 중
        HAPPY_PURR,     // 기쁨
        ANGRY_HISS,     // 화남
        REFUSE,         // 거절
        HUNGRY,         // 배고픔
        EATING,         // 식사
        EVOLVING,       // 진화
        SICK            // 아픔
    }

    public enum EScene
    {
        Unknown,
        TitleScene,
        GameScene,
    }

    public enum EUIEvent
    {
        Click,
        PointerDown,
        PointerUp,
        Drag,
    }

    public enum ESound
    {
        Bgm,
        Effect,
        Max,
    }

    public static int MaxHunger = 100;
    public static int MaxLoveScore = 100;
}
