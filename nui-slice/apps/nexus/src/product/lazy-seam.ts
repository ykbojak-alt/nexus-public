/**
 * Perf (NUE-UI perf-budget dozhim): разделять тяжёлые интеграции на
 * ленивые чанки, сохраняя синхронный интерфейс seam-объекта.
 *
 * Первый вызов любого метода начинает import() нужного модуля и
 * делегирует ему; последующие вызовы используют тот же загруженный
 * инстанс. Семантика «объект всегда существует, методы async» не
 * меняется — экраны продолжают вызывать `seam.method()` и await'ить.
 *
 * Сеам — рекурсивный: доступ к вложенным объектам (`seam.x.listTweets()`)
 * создаёт вложенный seam-сегмент с тем же lazy-поведением. Значения-свойства
 * (не методы) синхронно недоступны — для чтения состояния используйте методы
 * (например, getState() с последующей выборкой поля из результата).
 */
export function createLazySeam<T extends object>(load: () => Promise<T>): T {
  let inst: T | null = null;
  let loading: Promise<T> | null = null;
  const getInst = (): Promise<T> => {
    if (inst) return Promise.resolve(inst);
    loading ??= load().then((m) => {
      inst = m;
      loading = null;
      return m;
    });
    return loading;
  };

  // makeSeam создаёт сегмент для пути к значению:
  //   valueOf(m) — вытащить значение по пути (для apply — функцию),
  //   ownerOf(m) — объект-владелец метода (this при вызове),
  //   path — полный путь от корня (для диагностики).
  const makeSeam = (
    valueOf: (m: T) => unknown,
    ownerOf: (m: T) => unknown,
    path: string,
  ): unknown => {
    const proxy = new Proxy(function lazySeamProxy() {} as (...a: unknown[]) => unknown, {
      get(_target, prop, receiver) {
        if (typeof prop === 'symbol') return Reflect.get(_target, prop, receiver);
        const name = String(prop);
        if (name === 'then') return undefined; // не thenable
        if (name === 'isLazySeam') return true;
        return makeSeam(
          (m) => (valueOf(m) as Record<string, unknown> | null | undefined)?.[name],
          (m) => valueOf(m) as Record<string, unknown>,
          path ? `${path}.${name}` : name,
        );
      },
      apply(_target, _thisArg, args) {
        return getInst().then((m) => {
          const fn = valueOf(m);
          if (typeof fn !== 'function') {
            throw new Error(`lazy seam: unknown method ${path || '<seam>'}`);
          }
          return fn.apply(ownerOf(m) as object, args);
        });
      },
    });
    return proxy;
  };

  return makeSeam((m) => m, (m) => m, '') as T;
}
