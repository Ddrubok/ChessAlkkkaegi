using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System;
using Object = UnityEngine.Object;

public class ResourceManager
{
    // 로드된 리소스를 캐싱해두는 딕셔너리
    Dictionary<string, Object> _resources = new Dictionary<string, Object>();

    /// <summary>
    /// Resources 폴더에서 동기 방식으로 리소스를 로드합니다.
    /// </summary>
    public T Load<T>(string path) where T : Object
    {
        // 1. 캐시에 이미 리소스가 있다면 바로 반환
        if (_resources.TryGetValue(path, out Object resource))
            return resource as T;

        // 2. 캐시에 없다면 Resources 폴더에서 로드
        T loadedResource = Resources.Load<T>(path);

        // 3. 로드에 성공했다면 캐시에 추가 후 반환
        if (loadedResource != null)
        {
            _resources.Add(path, loadedResource);
        }
        else
        {
            Debug.LogWarning($"Failed to load resource at path: {path}");
        }

        return loadedResource;
    }

    public GameObject Instantiate(string path, Transform parent = null, bool pooling = false)
    {
        // 위에서 만든 Load 함수를 이용해 동기로 프리팹을 가져옵니다.
        GameObject prefab = Load<GameObject>(path);
        if (prefab == null)
        {
            Debug.LogError($"Failed to load prefab : {path}");
            return null;
        }

        // 풀링 사용 시
        if (pooling)
            return Managers.Pool.Pop(prefab);

        // 일반 생성
        GameObject go = Object.Instantiate(prefab, parent);
        go.name = prefab.name; // "(Clone)" 텍스트 제거
        return go;
    }

    public void Destroy(GameObject go)
    {
        if (go == null)
            return;

        // 풀링된 객체라면 풀로 돌려보냄
        if (Managers.Pool.Push(go))
            return;

        Object.Destroy(go);
    }

    #region 비동기 및 폴더 단위 로드 (Resources)

    /// <summary>
    /// Resources.LoadAsync를 이용한 비동기 로드
    /// </summary>
    public void LoadAsync<T>(string path, Action<T> callback = null) where T : Object
    {
        // 캐시 확인
        if (_resources.TryGetValue(path, out Object resource))
        {
            callback?.Invoke(resource as T);
            return;
        }

        // 비동기 로드 시작
        ResourceRequest request = Resources.LoadAsync<T>(path);
        request.completed += (op) =>
        {
            T result = request.asset as T;

            if (result != null && !_resources.ContainsKey(path))
            {
                _resources.Add(path, result);
            }

            callback?.Invoke(result);
        };
    }

    /// <summary>
    /// Resources 폴더 내의 특정 폴더 안에 있는 모든 에셋을 동기로 로드합니다.
    /// (Resources에서는 어드레서블의 Label 대신 폴더 경로를 사용합니다)
    /// </summary>
    public void LoadAll<T>(string folderPath, Action<string, int, int> callback = null) where T : Object
    {
        T[] loadedResources = Resources.LoadAll<T>(folderPath);

        int totalCount = loadedResources.Length;
        int loadCount = 0;

        foreach (T resource in loadedResources)
        {
            // 리소스 이름(또는 경로)를 키로 사용하여 캐싱
            // 주의: 폴더 로드시 정확한 경로(path) 구성 방법에 따라 키 값을 맞춰주어야 합니다.
            string key = $"{folderPath}/{resource.name}";

            if (!_resources.ContainsKey(key))
            {
                _resources.Add(key, resource);
            }

            loadCount++;
            callback?.Invoke(resource.name, loadCount, totalCount);
        }
    }

    /// <summary>
    /// 메모리 관리를 위해 캐시를 비울 때 사용합니다.
    /// </summary>
    public void Clear()
    {
        _resources.Clear();
        Resources.UnloadUnusedAssets();
    }
    #endregion
}