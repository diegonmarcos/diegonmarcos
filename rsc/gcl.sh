#!/bin/bash

### Force pull: discard all local changes and use remote version
git_force_pull() {
    local repo=$1
    local branch=${2:-main}
    
    if [ -d "$repo" ]; then
        echo "Force pulling $repo (keeping remote version)..."
        git -C "$repo" fetch origin
        git -C "$repo" reset --hard "origin/$branch"
    else
        echo "Cloning $repo..."
        git clone "$2" "$repo"
    fi
}

### Clone or pull with preference for local changes
clone_or_pull() {
    local repo=$2
    local url=$3
	local merge_strategy=$1
    
    if [ -d "$repo" ]; then
        echo "Pulling $repo (keeping #"$merge_strategy" version on conflicts)..."
        git -C "$repo" pull -s recursive -X "$merge_strategy"
    else
        echo "Cloning $repo..."
        git clone "$url" "$repo"
    fi
}

main() {
    ### Choose your strategy
    local mode=$1							### 'local' or 'remote' or default
	local strategy=$2  						### 'local' or 'remote' or default
    local pull_function="clone_or_pull" 	### Default to remote
    
    if [ "$strategy" == "local" ]; then
        pull_function="clone_or_pull ours"
        echo "Using strategy: Keep local changes"
    else
	    pull_function="clone_or_pull theirs"
        echo "Using strategy: Keep remote changes"
    fi
    
    if [ "$mode" == "0" ]; then
        ### HTTPS URLs
        $pull_function "profile" "https://github.com/diegonmarcos/diegonmarcos.git"
        $pull_function "mylibs" "https://github.com/diegonmarcos/mylibs.git"
        $pull_function "system" "https://github.com/diegonmarcos/system.git"
        $pull_function "algo" "https://github.com/diegonmarcos/algo.git"
        $pull_function "graphic" "https://github.com/diegonmarcos/graphic.git"
        
    elif [ "$mode" == "1" ]; then
        ### SSH URLs
        $pull_function "profile" "git@github.com:diegonmarcos/diegonmarcos.git"
        $pull_function "mylibs" "git@github.com:diegonmarcos/mylibs.git"
        $pull_function "system" "git@github.com:diegonmarcos/system.git"
        $pull_function "algo" "git@github.com:diegonmarcos/algo.git"
        $pull_function "graphic" "git@github.com:diegonmarcos/graphic.git"
		$pull_function "dev" "git@github.com:diegonmarcos/DevelopmentProjects.git"
        $pull_function "lecole42" "git@github.com:diegonmarcos/lecole42.git"
        $pull_function "website" "git@github.com:diegonmarcos/diegonmarcos.github.io.git"

    else
		echo "### USE"
		echo "  $0 [0 | 1] [local | remote]"
		echo "    0: https: public"
		echo "    1: ssh  : private"
		echo "    local: Keep local changes"
		echo "    remote: Keep remote changes (default)"

    fi
}

main "$1" "$2"