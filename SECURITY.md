# セキュリティポリシー

## 脆弱性の報告

Vege-Table に脆弱性を見つけたら、公開の Issue には書かず、GitHub の [Private vulnerability reporting](https://github.com/kan/vegtab/security/advisories/new) から報告してください。報告の内容は、修正を公開するまでメンテナーにだけ見えます。

報告には次の内容を書いてください。

- 脆弱性の内容
- 再現の手順
- 想定される影響（読み書きできるデータ、必要な権限など）

受け取った報告は、できるだけ早く確認して返信します。

## 対象

対象は、このリポジトリのコード（`main` ブランチの最新）と、そこからデプロイしている `https://vegtab.kan-game.app`（旧 URL `https://vegtab.app` を含む）です。リリースの版は切っていないので、古いコミットへの修正の適用は行いません。

次のものは、それぞれの報告先へお願いします。

- kan-game.app の ID 基盤（ID の発行と検証、名前、退会、ポータル）の問題: [kan/game](https://github.com/kan/game/security/policy)
- 依存しているライブラリの問題: そのライブラリの報告先
