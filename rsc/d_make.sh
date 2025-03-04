#!/bin/bash
# **************************************************************************** #
#                                                                              #
#                                                         :::      ::::::::    #
#    make.sh                                            :+:      :+:    :+:    #
#                                                     +:+ +:+         +:+      #
#    By: dinepomu <dinepomu@student.42berlin.de>    +#+  +:+       +#+         #
#                                                 +#+#+#+#+#+   +#+            #
#    Created: 2025/03/02 12:30:02 by dinepomu          #+#    #+#              #
#    Updated: 2025/03/03 06:51:52 by dinepomu         ###   ########.fr        #
#                                                                              #
# **************************************************************************** #

###  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ###
# ############################################################################ #
#                          MAIN FUNCTIONS			                           #
# ############################################################################ #

# ************************************************************************ #
# *** Build *** #
build ()
{
######**BUILD AND RUN THE IMAGE**######
### Create the docker image
create_dockerfile

### Build the docker image
#export DOCKER_BUILDKIT=1
docker build -t d_image .

### Run the docker image
S_PATH="../2.CODE"
docker run -d -it \
	--name d_container \
	-v "$PWD/${S_PATH}:/program_root" \
	-v /home/diego/Documents/Git/mylib/:/mylib \
	-e PATH="$PATH:$HOME/.local/bin" \
	d_image \
	bash
}
# ************************************************************************ #
# *** Run *** #
run ()
{
docker exec -it d_container bash
}

# ************************************************************************ #
# *** Clear *** #
clear ()
{
docker stop d_container
docker rm d_container
}

# ************************************************************************ #
# *** Rebuild *** #
rebuild ()
{
clear
build
}

# ************************************************************************ #
# *** List *** #
list ()
{
docker ps -a 
}

###  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ###
# ############################################################################ #
#                          			UTILS			                           #
# ############################################################################ #

function create_dockerfile() 
{
	cat <<EOF > Dockerfile
### Ubuntu base image
FROM ubuntu:latest

### Install necessary system packages
RUN apt update && \
	apt install -y \
	build-essential bash-completion command-not-found less man-db time \
	vim nano \
	make cmake \
	git tar wget \
	gcc gdb \
	clang clang-tidy lldb \
	valgrind kcachegrind \
	xdotool bear \
	doxygen graphviz \
	libpq-dev libbsd-dev libncurses-dev libxext-dev \
	python3 pipx python3-pip python3-dev python3-venv python3-wheel \
	&& rm -rf /var/lib/apt/lists/*
RUN pipx install \
	pipenv \
	gdown \
	&& rm -rf /var/lib/apt/lists/*

### Additional packages (separately from the above layer to avoid re-processing)
#RUN apt install -y \
#	command-not-found less man-db time \

### Set the environment variables
ENV PATH="\${PATH}:/root/.local/bin"

### Folder source code
#RUN git clone <GIT_REPO_URL> /push_swap
#COPY push_swap /push_swap
#RUN from mounted mirrored volume done in the docker-compose file

### Set the working directory
WORKDIR /program_root
EOF
}



###  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ###
# ############################################################################ #
#                          				MAIN	                               #
# ############################################################################ #
main ()
{
if [ "$1" == "run" ]; then
	run
elif [ "$1" == "clear" ]; then
	clear
elif [ "$1" == "re" ]; then
	rebuild
elif [ "$1" == "list" ]; then
	list
elif [ "$1" == "dockerfile" ]; then
	create_dockerfile
else
	rebuild
	run
fi
}

main $@