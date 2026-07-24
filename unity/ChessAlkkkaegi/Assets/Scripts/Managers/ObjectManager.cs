using System.Collections.Generic;
using UnityEngine;
using static Define;

public class ObjectManager
{
    public Dictionary<string, Sprite> DicSprite = new Dictionary<string, Sprite>();

    public T Spawn<T>(Vector3 position, int templateID = 0, Transform parent = null) where T : BaseController
    {
        System.Type type = typeof(T);

        //if (type == typeof(ItemController))
        //{
        //    GameObject go = Managers.Resource.Instantiate("Prefabs\\Item");
        //    go.transform.SetParent(parent);
        //    go.transform.position = position;
        //    go.transform.localScale = Vector3.one;

        //    if (templateID == 0)
        //    {
        //        WeaponController wc = go.GetOrAddComponent<WeaponController>();

        //        return wc as T;
        //    }
        //    else if (templateID == 1)
        //    {
        //        ArmorController ac = go.GetOrAddComponent<ArmorController>();

        //        return ac as T;
        //    }
        //    else if (templateID == 2)
        //    {
        //        ShieldController sc = go.GetOrAddComponent<ShieldController>();

        //        return sc as T;
        //    }
        //}

        return null;
    }

    public void Despawn<T>(T obj) where T : BaseController
    {
        System.Type type = typeof(T);
    }

    public Sprite GetSprite(string name)
    {
        Sprite newSprite;
        if (!DicSprite.TryGetValue(name, out newSprite))
        {
            newSprite = Resources.Load<Sprite>( name);
            DicSprite.Add(name, newSprite);
        }
        if (newSprite == null)
            Debug.Log(name);

        return newSprite;
    }
}
