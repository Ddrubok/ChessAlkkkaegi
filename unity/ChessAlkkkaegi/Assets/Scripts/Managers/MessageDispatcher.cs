using System;
using System.Collections.Generic;
using UnityEngine;
using static Define; // 앞서 만든 EGlobalEvent 사용

public class MessageDispatcher
{
    public delegate void EventDelegate(EventData eventData);
    public delegate void SimpleEventDelegate();

    // 인스턴스 변수로 변경 (static 제거)
    private Dictionary<EGlobalEvent, EventDelegate> _delegates = new Dictionary<EGlobalEvent, EventDelegate>();
    private Dictionary<EGlobalEvent, SimpleEventDelegate> _simpleDelegates = new Dictionary<EGlobalEvent, SimpleEventDelegate>();

    // static을 모두 제거하고 객체 지향적으로 변경합니다.
    public void Register(EGlobalEvent eventName, EventDelegate del)
    {
        if (_delegates.ContainsKey(eventName))
            _delegates[eventName] += del;
        else
            _delegates.Add(eventName, del);
    }

    public void Register(EGlobalEvent eventName, SimpleEventDelegate del)
    {
        if (_simpleDelegates.ContainsKey(eventName))
            _simpleDelegates[eventName] += del;
        else
            _simpleDelegates.Add(eventName, del);
    }

    public void UnRegister(EGlobalEvent eventName, EventDelegate del)
    {
        if (_delegates.ContainsKey(eventName))
        {
            _delegates[eventName] -= del;
            if (_delegates[eventName] == null)
                _delegates.Remove(eventName);
        }
    }

    public void UnRegister(EGlobalEvent eventName, SimpleEventDelegate del)
    {
        if (_simpleDelegates.ContainsKey(eventName))
        {
            _simpleDelegates[eventName] -= del;
            if (_simpleDelegates[eventName] == null)
                _simpleDelegates.Remove(eventName);
        }
    }

    public void Dispatch(EGlobalEvent eventName, EventData eventData)
    {
        if (_delegates.TryGetValue(eventName, out var del) && del != null)
            del.Invoke(eventData);
    }

    public void Dispatch(EGlobalEvent eventName)
    {
        if (_simpleDelegates.TryGetValue(eventName, out var del) && del != null)
            del.Invoke();
    }

    // 씬 전환 시 매우 중요: 쌓인 이벤트를 날려버려 메모리 누수를 방지합니다.
    public void Clear()
    {
        _delegates.Clear();
        _simpleDelegates.Clear();
    }
}
public class EventData
{
    public object value { get { return GetValue(); } }
    virtual protected object GetValue() { return null; }

    public EventData()
    {
    }
}
public class EventData<T> : EventData
{
    new public T value { get; private set; }
    protected override object GetValue() { return value; }
    public EventData(T value) : base()
    {
        this.value = value;
    }
}