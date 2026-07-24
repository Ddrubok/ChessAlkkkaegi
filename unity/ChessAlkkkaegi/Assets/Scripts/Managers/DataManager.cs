using Data;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Linq.Expressions;
using Unity.VisualScripting;
using UnityEngine;
using static Define;
using static Util;

public interface ILoader<Key, Value>
{
    Dictionary<Key, Value> MakeDict();
}

public interface ILoader<Value>
{
    void GetData();
}

public class DataManager
{
    public Dictionary<int, Data.TestData> TestDic { get; private set; } = new Dictionary<int, Data.TestData>();
  
    public void Init()
    {
        Debug.Log("게임 데이터 로드 완료");
    }

    private Loader LoadJson<Loader, Key, Value>(string path) where Loader : ILoader<Key, Value>
    {
        TextAsset textAsset = Managers.Resource.Load<TextAsset>("Data\\" + path);
        return JsonConvert.DeserializeObject<Loader>(textAsset.text);
    }

    private Loader LoadJson<Loader, Value>(string path) where Loader : ILoader<Value>
    {
        TextAsset textAsset = Managers.Resource.Load<TextAsset>("Data\\" + path);
        return JsonConvert.DeserializeObject<Loader>(textAsset.text);
    }

    public static List<T> ReadCsv<T>(string path) where T : new()
    {
        List<T> dataList = new List<T>();

        TextAsset textAsset = Managers.Resource.Load<TextAsset>("Data\\" + path);
        if (textAsset == null)
        {
            Debug.LogError($"CSV 파일을 찾을 수 없습니다: {path}");
            return null;
        }

        using (StringReader reader = new StringReader(textAsset.text))
        {
            string line;
            bool isHeader = true;

            while ((line = reader.ReadLine()) != null)
            {
                if (isHeader)
                {
                    isHeader = false;
                    continue;
                }
                T data = ParseCsvLine<T>(line);
                dataList.Add(data);
            }
        }

        return dataList;
    }

    private static T ParseCsvLine<T>(string line) where T : new()
    {
        T data = new T();
        string[] values = line.Split(',');

        var properties = typeof(T).GetProperties();
        for (int i = 0; i < properties.Length && i < values.Length; i++)
        {
            var property = properties[i];
            if (property.CanWrite)
            {
                object value;

                if (property.PropertyType.IsEnum)
                {
                    value = Enum.Parse(property.PropertyType, values[i]);
                }
                else
                {
                    value = Convert.ChangeType(values[i], property.PropertyType);
                }

                property.SetValue(data, value);
            }
        }

        return data;
    }
}
