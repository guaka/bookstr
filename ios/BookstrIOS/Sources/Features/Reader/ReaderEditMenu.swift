import UIKit

enum ReaderEditMenu {
    static func configure(
        _ builder: UIMenuBuilder,
        selection: String,
        allowsSpeech: Bool,
        addWord: @escaping () -> Void,
        mark: @escaping () -> Void,
        readFromHere: @escaping () -> Void
    ) {
        builder.remove(menu: .lookup)
        builder.remove(menu: .share)
        builder.remove(menu: .replace)
        builder.remove(menu: .speech)
        let extras = extraActions(
            for: selection,
            allowsSpeech: allowsSpeech,
            addWord: addWord,
            mark: mark,
            readFromHere: readFromHere
        )
        // Keep Copy and attach Bookstr actions in the same edit group. Sibling
        // insertion after .standardEdit is unreliable for WKWebView bubbles.
        builder.replaceChildren(ofMenu: .standardEdit) { children in
            copyOnly(from: children) + extras
        }
    }

    static func menu(
        defaultActions: [UIMenuElement],
        selection: String,
        allowsSpeech: Bool,
        addWord: @escaping () -> Void,
        mark: @escaping () -> Void,
        readFromHere: @escaping () -> Void
    ) -> UIMenu {
        UIMenu(
            children: copyOnly(from: defaultActions) + extraActions(
                for: selection,
                allowsSpeech: allowsSpeech,
                addWord: addWord,
                mark: mark,
                readFromHere: readFromHere
            )
        )
    }

    static func copyOnly(from actions: [UIMenuElement]) -> [UIMenuElement] {
        actions.compactMap { element in
            if isCopy(element) { return element }
            guard let menu = element as? UIMenu else { return nil }
            let children = copyOnly(from: menu.children)
            guard !children.isEmpty else { return nil }
            return UIMenu(
                title: menu.title,
                image: menu.image,
                identifier: menu.identifier,
                options: menu.options,
                children: children
            )
        }
    }

    static func extraActions(
        for selection: String,
        allowsSpeech: Bool,
        addWord: @escaping () -> Void,
        mark: @escaping () -> Void,
        readFromHere: @escaping () -> Void
    ) -> [UIMenuElement] {
        ReaderSelectionActions.menuItems(for: selection, allowsSpeech: allowsSpeech).map { item in
            switch item {
            case .addWord:
                UIAction(title: "Add Word", image: UIImage(systemName: "character.textbox")) { _ in
                    addWord()
                }
            case .mark:
                UIAction(title: "Mark", image: UIImage(systemName: "bookmark")) { _ in
                    mark()
                }
            case .readFromHere:
                UIAction(
                    title: ReaderSelectionActions.readFromHereLabel,
                    image: UIImage(systemName: "play.fill")
                ) { _ in
                    readFromHere()
                }
            }
        }
    }

    private static func isCopy(_ element: UIMenuElement) -> Bool {
        if let command = element as? UICommand {
            return command.action == #selector(UIResponderStandardEditActions.copy(_:))
        }
        if let action = element as? UIAction {
            return action.discoverabilityTitle == "Copy"
                || action.title == "Copy"
                || action.identifier == UIAction.Identifier("Copy")
        }
        return false
    }
}
