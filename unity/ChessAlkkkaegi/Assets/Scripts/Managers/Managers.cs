using System.Collections;
using System.Collections.Generic;
using Unity.VisualScripting;
using UnityEngine;

public class Managers : MonoBehaviour
{
    private static Managers s_instance;
    public static Managers Instance { get { Init(); return s_instance; } }


    #region Core
    private GameManager _game;
    private DataManager _data;
    private ResourceManager _resource;
    private SoundManager _sound;
    private UIManager _ui;
    private ObjectManager _object;
    private PoolManager _pool;
    private MessageDispatcher _message;

    public static GameManager Game { get { return Instance?._game; } }
    public static DataManager Data { get { return Instance?._data; } }
    public static ResourceManager Resource { get { return Instance?._resource; } }
    public static SoundManager Sound { get { return Instance?._sound; } }
    public static UIManager UI { get { return Instance?._ui; } }

    public static ObjectManager Object { get { return Instance?._object; } }

    public static PoolManager Pool { get { return Instance?._pool; } }

    public static MessageDispatcher Message { get { return Instance?._message; } }

    #endregion

    public static void Init()
    {
        if (s_instance == null)
        {
            GameObject go = GameObject.Find("@Managers");
            if (go == null)
            {
                go = new GameObject { name = "@Managers" };
                go.GetOrAddComponent<Managers>();
            }

            DontDestroyOnLoad(go);

            // 초기??
            s_instance = go.GetComponent<Managers>();
            
            s_instance._game = new GameManager();
            Game.Init();
            s_instance._data = new DataManager();
            s_instance._resource = new ResourceManager();
            s_instance._sound = s_instance.AddComponent<SoundManager>();
            s_instance._ui = new UIManager();
            s_instance._object = new ObjectManager();
            s_instance._pool = new PoolManager();
            s_instance._message = new MessageDispatcher();
        }
    }

    private void Update()
    {
        _game?.Tick();
    }

    private void OnApplicationQuit()
    {
        if (s_instance != null)
        {
            s_instance = null;
            Destroy(gameObject);
        }
    }
}
