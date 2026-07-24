using Data;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Net;
using Unity.VisualScripting;
using UnityEngine;
using static Define;
using Color = UnityEngine.Color;
using ColorUtility = UnityEngine.ColorUtility;


public static class Util
{
	public static T GetOrAddComponent<T>(GameObject go) where T : UnityEngine.Component
	{
		T component = go.GetComponent<T>();
		if (component == null)
			component = go.AddComponent<T>();

		return component;
	}

	public static GameObject FindChild(GameObject go, string name = null, bool recursive = false)
	{
		Transform transform = FindChild<Transform>(go, name, recursive);
		if (transform == null)
			return null;

		return transform.gameObject;
	}

	public static T FindChild<T>(GameObject go, string name = null, bool recursive = false) where T : UnityEngine.Object
	{
		if (go == null)
			return null;

		if (recursive == false)
		{
			for (int i = 0; i < go.transform.childCount; i++)
			{
				Transform transform = go.transform.GetChild(i);
				if (string.IsNullOrEmpty(name) || transform.name == name)
				{
					T component = transform.GetComponent<T>();
					if (component != null)
						return component;
				}
			}
		}
		else
		{
			foreach (T component in go.GetComponentsInChildren<T>())
			{
				if (string.IsNullOrEmpty(name) || component.name == name)
					return component;
			}
		}

		return null;
	}

	public static T ParseEnum<T>(string value)
	{
		return (T)Enum.Parse(typeof(T), value, true);
	}

    public static Color ColorToHexCode(string hexCode)
    {
        Color color;
        if (ColorUtility.TryParseHtmlString(hexCode, out color))
        {
            return color;
        }

        return Color.white;
    }

    public static string ConvertToCurrencyFormat(int number)
    {
        if (number < 1000)
        {
            return number.ToString();
        }
        else if (number >= 1000 && number < 1_000_000)
        {
            return (number / 1000D).ToString("0.##") + "k"; 
        }
        else if (number >= 1_000_000 && number < 1_000_000_000)
        {
            return (number / 1_000_000D).ToString("0.##") + "m"; 
        }
        else
        {
            return (number / 1_000_000_000D).ToString("0.##") + "b"; 
        }
    }

    public static string ConvertToCurrencyFormat(ulong number)
    {
        if (number < 1000)
        {
            return number.ToString();
        }
        else if (number >= 1000 && number < 1_000_000)
        {
            return (number / 1000D).ToString("0.##") + "k";
        }
        else if (number >= 1_000_000 && number < 1_000_000_000)
        {
            return (number / 1_000_000D).ToString("0.##") + "m";
        }
        else
        {
            return (number / 1_000_000_000D).ToString("0.##") + "b";
        }
    }

    public static Dictionary<TKey, T> CreateDictionaryFromList<T, TKey>(List<T> list, Func<T, TKey> keySelector)
    {
        return list.ToDictionary(keySelector);
    }

    public static SortedDictionary<TKey, T> CreateSortedDictionaryDictionaryFromList<T, TKey>(List<T> list, Func<T, TKey> keySelector)
    {
        var dictionary = list.ToDictionary(keySelector);

        return new SortedDictionary<TKey, T>(dictionary);
    }

    public static int GetTransformedValue(int number, SortedDictionary<int, ItemOptionUpgradeData> thresholds)
    {
        foreach (var key in thresholds.Keys)
        {
            if (number < key)
            {
                return key; 
            }
            number = key;
        }

        return number; 
    }
}