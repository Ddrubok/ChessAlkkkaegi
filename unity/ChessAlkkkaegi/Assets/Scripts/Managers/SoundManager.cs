using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class SoundManager : MonoBehaviour
{
    private AudioSource[] _audioSources = new AudioSource[(int)Define.ESound.Max];
    private Dictionary<string, AudioClip> _audioClips = new Dictionary<string, AudioClip>();

    private void Awake()
    {
        string[] soundTypeNames = System.Enum.GetNames(typeof(Define.ESound));
        for (int count = 0; count < soundTypeNames.Length - 1; count++)
        {
            GameObject go = new GameObject { name = soundTypeNames[count] };
            _audioSources[count] = go.AddComponent<AudioSource>();
            go.transform.parent = gameObject.transform;
        }

        _audioSources[(int)Define.ESound.Bgm].loop = true;
    }

    public void Play(Define.ESound type, string key, float pitch = 1.0f)
    {
        AudioSource audioSource = _audioSources[(int)type];

        if (type == Define.ESound.Bgm)
        {
            LoadAudioClip(key, (audioClip) =>
            {
                if (audioSource.isPlaying)
                    audioSource.Stop();

                audioSource.clip = audioClip;
                audioSource.Play();
            });
        }
        else
        {
            LoadAudioClip(key, (audioClip) =>
            {
                audioSource.pitch = pitch;
                audioSource.PlayOneShot(audioClip);
            });
        }
    }

    private void LoadAudioClip(string key, Action<AudioClip> callback)
    {
        AudioClip audioClip = null;
        key = "Sound\\" + key;
        if (_audioClips.TryGetValue(key, out audioClip))
        {
            callback?.Invoke(audioClip);
            return;
        }

        audioClip = Managers.Resource.Load<AudioClip>(key);

        if (_audioClips.ContainsKey(key) == false)
            _audioClips.Add(key, audioClip);

        callback?.Invoke(audioClip);
    }
}
