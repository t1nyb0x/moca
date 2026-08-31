//! CeVIO AI を COM で直に叩く実証。
//!
//! いまは shirataki (Node の HTTP サーバー) を挟んでいるが、moca が頼んで
//! いるのは 3 つだけである。キャストの一覧、感情成分の名前、合成。
//!
//! shirataki の実装を読むと、CeVIO 側の口はさらに小さい。
//!
//! ```text
//! CeVIO.Talk.RemoteService2.ServiceControl2V40  → StartHost(false)
//! CeVIO.Talk.RemoteService2.Talker2V40          → Cast, Components,
//!                                                  AvailableCasts,
//!                                                  OutputWaveToFile(text, path)
//! ```
//!
//! いずれも `IDispatch` の遅延束縛で呼べる。ここではそれが Rust から通るか
//! だけを確かめる。通れば shirataki を挟まずに済み、「合成器を別途起動して
//! おく必要がある」という制限が CeVIO については消える。
//!
//! **この経路は Windows と CeVIO AI の導入が要る。** 試験は既定で除外する。

use windows::core::{BSTR, GUID, PCWSTR, VARIANT};
use windows::Win32::System::Com::{
    CLSIDFromProgID, CoCreateInstance, CoInitializeEx, IDispatch, CLSCTX_ALL, COINIT_MULTITHREADED,
    DISPATCH_METHOD, DISPATCH_PROPERTYGET, DISPPARAMS,
};

/// 呼び出しの失敗。実証なので文言だけ持つ。
pub type Result<T> = std::result::Result<T, String>;

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// 名前から DISPID を引く。COM の遅延束縛はここから始まる。
fn dispid(target: &IDispatch, name: &str) -> Result<i32> {
    let name = wide(name);
    let mut id = 0i32;
    unsafe {
        target
            .GetIDsOfNames(&GUID::zeroed(), &PCWSTR(name.as_ptr()), 1, 0, &mut id)
            .map_err(|error| format!("{name:?} の DISPID を引けません: {error}"))?;
    }
    Ok(id)
}

/// 引数なしのプロパティ取得。
fn get(target: &IDispatch, name: &str) -> Result<VARIANT> {
    let id = dispid(target, name)?;
    let mut out = VARIANT::default();
    let params = DISPPARAMS::default();
    unsafe {
        target
            .Invoke(
                id,
                &GUID::zeroed(),
                0,
                DISPATCH_PROPERTYGET,
                &params,
                Some(&mut out),
                None,
                None,
            )
            .map_err(|error| format!("{name} を取得できません: {error}"))?;
    }
    Ok(out)
}

/// 引数を渡してメソッドを呼ぶ。DISPPARAMS の引数は逆順に並べる決まり。
fn call(target: &IDispatch, name: &str, args: &mut [VARIANT]) -> Result<VARIANT> {
    let id = dispid(target, name)?;
    args.reverse();
    let params = DISPPARAMS {
        rgvarg: args.as_mut_ptr(),
        cArgs: args.len() as u32,
        ..Default::default()
    };
    let mut out = VARIANT::default();
    unsafe {
        target
            .Invoke(
                id,
                &GUID::zeroed(),
                0,
                DISPATCH_METHOD,
                &params,
                Some(&mut out),
                None,
                None,
            )
            .map_err(|error| format!("{name} を呼べません: {error}"))?;
    }
    Ok(out)
}

fn as_dispatch(value: &VARIANT) -> Result<IDispatch> {
    IDispatch::try_from(value).map_err(|error| format!("IDispatch として読めません: {error}"))
}

fn as_i32(value: &VARIANT) -> Result<i32> {
    i32::try_from(value).map_err(|error| format!("整数として読めません: {error}"))
}

fn as_string(value: &VARIANT) -> Result<String> {
    BSTR::try_from(value)
        .map(|text| text.to_string())
        .map_err(|error| format!("文字列として読めません: {error}"))
}

/// COM を使う前に一度だけ呼ぶ。二重の初期化は害がないので握りつぶす。
///
/// **MTA で入る。** CeVIO の COM は別プロセスにあるため、呼び出しはプロセス間
/// で受け渡される。STA で入るとその受け渡しにメッセージの循環が要るが、
/// Rust のスレッドは Windows のメッセージ循環を持たない。呼び出しが永久に
/// 返らなくなる。
fn init() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

fn create(prog_id: &str) -> Result<IDispatch> {
    let id = wide(prog_id);
    unsafe {
        let clsid = CLSIDFromProgID(PCWSTR(id.as_ptr()))
            .map_err(|error| format!("{prog_id} が登録されていません: {error}"))?;
        CoCreateInstance(&clsid, None, CLSCTX_ALL)
            .map_err(|error| format!("{prog_id} を作れません: {error}"))
    }
}

/// CeVIO AI を起動し、使えるキャストの名前を返す。
///
/// shirataki が最初にしていることと同じ。ここが通れば、残りの操作も同じ
/// 調子で書ける。
pub fn available_casts() -> Result<Vec<String>> {
    init();

    let service = create("CeVIO.Talk.RemoteService2.ServiceControl2V40")?;
    // 引数の false は「他のプロセスが使っていても起動する」の意
    call(&service, "StartHost", &mut [VARIANT::from(false)])?;

    let talker = create("CeVIO.Talk.RemoteService2.Talker2V40")?;
    let casts = as_dispatch(&get(&talker, "AvailableCasts")?)?;
    let count = as_i32(&get(&casts, "Length")?)?;

    let mut names = Vec::new();
    for index in 0..count {
        let item = call(&casts, "At", &mut [VARIANT::from(index)])?;
        names.push(as_string(&item)?);
    }
    Ok(names)
}

#[cfg(test)]
mod tests {
    #![allow(non_snake_case)]
    use super::*;

    /// 実物の CeVIO AI が要る。`cargo test -- --ignored cevio` で確かめる。
    #[test]
    #[ignore = "CeVIO AI の導入と起動が必要"]
    fn 実物の_CeVIO_からキャストを取れる() {
        let casts = available_casts().expect("キャストを取れません");
        println!("キャスト {} 名: {casts:?}", casts.len());
        assert!(!casts.is_empty(), "キャストが 1 名も返っていない");
    }
}
